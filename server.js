const express = require("express");
// const https = require("https");
// const fs = require("fs");
// const path = require("path");
const cors = require("cors");
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const { SignatureV4 } = require("@aws-sdk/signature-v4");
const { Sha256 } = require("@aws-crypto/sha256-js");
const { HttpRequest } = require("@aws-sdk/protocol-http");
const { formatUrl } = require("@aws-sdk/util-format-url");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

require('dotenv').config()
const app = express();
const port = 3000;

const AWS_APP_ID = process.env.AWS_APP_ID
const AWS_APP_SECRET = process.env.AWS_APP_SECRET
const region = process.env.REGION;

// Check if AWS credentials are available
if (!AWS_APP_ID || !AWS_APP_SECRET || !region) {
  console.error("AWS credentials or region missing");
  throw new Error("AWS credentials not configured properly");
}

console.log("AWS region:", region);
console.log("AWS credentials available:", AWS_APP_ID ? "Yes" : "No");

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post("/speak", async (req, res) => {
  const polly = new PollyClient({
    credentials: {
      accessKeyId: AWS_APP_ID,
      secretAccessKey: AWS_APP_SECRET
    }, region
  });

  const { text } = req.body;
  const command = new SynthesizeSpeechCommand({
    OutputFormat: "mp3",
    Text: text,
    TextType: "text",
    VoiceId: "Matthew",
    Engine: "generative",
  });

  try {
    const response = await polly.send(command);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="speech.mp3"',
    });
    response.AudioStream.pipe(res);
  } catch (err) {
    console.error("Polly error:", err);
    res.status(500).json({ error: "Failed to synthesize speech" });
  }
});

app.get("/get-signed-url", async (req, res) => {
  try {
    const signedUrl = await getSignedWebSocketUrl();
    res.json({ url: signedUrl });
  } catch (error) {
    console.error("Error generating signed URL:", error);
    res.status(500).json({
      error: "Failed to generate signed URL for AWS Transcribe",
      message: error.message
    });
  }
})

async function getSignedWebSocketUrl() {
  
  console.log("Creating signed URL for region:", region);

  try {
    const hostname = `transcribestreaming.${region}.amazonaws.com`;
    const hostnameWithPort = `${hostname}:8443`;

    // Generate a UUID v4 for session ID
    const sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });

    console.log("Generated session ID:", sessionId);

    // Create the HTTP request object with all required parameters
    const request = new HttpRequest({
      protocol: "wss",
      hostname: hostname,
      port: 8443,
      method: "GET",
      path: "/stream-transcription-websocket",
      query: {
        "language-code": "en-US",
        "media-encoding": "pcm",
        "sample-rate": "16000",
        "session-id": sessionId,
        "enable-channel-identification": "false",
        "enable-partial-results-stabilization": "true",
        "partial-results-stability": "high",
        "content-identification-type": "PII",
        "show-speaker-labels": "false",
        "media-sample-rate-hertz": "16000",
        "audio-channel": "1"
      },
      headers: {
        host: hostnameWithPort,
        "x-amzn-transcribe-language-code": "en-US",
        "x-amzn-transcribe-media-encoding": "pcm",
        "x-amzn-transcribe-sample-rate": "16000",
        "x-amzn-transcribe-session-id": sessionId,
        "x-amz-date": new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
      }
    });

    // Create the signer with the correct configuration
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: AWS_APP_ID,
        secretAccessKey: AWS_APP_SECRET
      },
      region,
      service: "transcribe",
      sha256: Sha256,
      applyChecksum: false
    });

    // Sign the request
    const signed = await signer.presign(request, {
      expiresIn: 300,
      unsignableHeaders: new Set(['x-amzn-transcribe-language-code', 'x-amzn-transcribe-media-encoding', 'x-amzn-transcribe-sample-rate', 'x-amzn-transcribe-session-id'])
    });

    // Use the formatUrl utility to get the final URL
    const signedUrl = formatUrl(signed);
    console.log("Signed URL generated successfully");

    return signedUrl;
  } catch (error) {
    console.error("Error signing WebSocket URL:", error.message);
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
    throw new Error(`AWS credential error: ${error.message}`);
  }
}

app.post("/ask-claude", async (req, res) => {
  const bedrock = new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId: AWS_APP_ID,
      secretAccessKey: AWS_APP_SECRET,
    },
  });

  // const { prompt } = req.body;

  // const body = {
  //   prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
  //   max_tokens_to_sample: 300,
  //   temperature: 0.7,
  //   top_k: 250,
  //   top_p: 0.9,
  //   stop_sequences: ["\n\nHuman:"],
  // };

  // const command = new InvokeModelCommand({
  //   modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
  //   contentType: "application/json",
  //   accept: "application/json",
  //   body: JSON.stringify(body),
  //   inferenceConfiguration: {
  //     // instanceProfileId: "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
  //     inferenceProfileArn: "arn:aws:bedrock:us-east-2:641444422390:inference-profile/us.anthropic.claude-3-5-sonnet-20240620-v1:0",
  //   },
  // });

  const modelId = 'anthropic.claude-3-sonnet-20240229-v1:0'; // Model ID for Claude 3 Sonnet

  const params = {
    modelId: modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: req.body.prompt }]
        }
      ]
    })
  };

  try {
    const command = new InvokeModelCommand(params);
    const response = await bedrock.send(command);

    const responseBody = JSON.parse(Buffer.from(response.body).toString());
    res.json({ completion: responseBody.content[0].text });
  } catch (error) {
    console.error("Claude call failed:", error);
    res.status(500).json({ error: "Error calling Claude" });
  }
});

app.get("/", (req, res) => {
  res.send('Okay');
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});

// module.exports = app;