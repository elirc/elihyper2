# AWS AI Services Backend

This project demonstrates various AWS AI services:
- Text-to-Speech with AWS Polly
- Live Transcription with AWS Transcribe
- AI Responses with Claude on AWS Bedrock

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file in the project root with your AWS credentials:
   ```
   AWS_APP_ID=your_aws_access_key_id
   AWS_APP_SECRET=your_aws_secret_access_key
   REGION=us-east-1
   ```

   > **Important**: Your AWS user/role needs permissions for Polly, Transcribe, and Bedrock services.

4. Start the development server:
   ```
   npm run dev
   ```
5. Open your browser to http://localhost:3000

## Features

### Text-to-Speech (AWS Polly)
Enter text and have it spoken using AWS Polly's neural voice technology.

### Live Transcription (AWS Transcribe)
Speak into your microphone and see your words transcribed in real-time.

### AI Assistant (Claude via AWS Bedrock)
Ask questions and get responses from Claude AI through AWS Bedrock.

## Troubleshooting

### AWS Credentials
If you see "AWS credentials not configured properly" errors, make sure your `.env` file exists and has the correct credentials.

#### AWS Transcribe Specific Requirements
For the live transcription feature to work, your AWS credentials need:

1. **Proper Format**:
   - Access Key ID should start with 'AKIA'
   - Secret Access Key should be valid

2. **Required Permissions**:
   - `transcribe:StartStreamTranscription` permission
   - `transcribe:StartStreamTranscriptionWebSocket` permission

You can create an IAM policy with these permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "transcribe:StartStreamTranscription",
        "transcribe:StartStreamTranscriptionWebSocket"
      ],
      "Resource": "*"
    }
  ]
}
```

### Microphone Access
The transcription feature requires microphone access. Make sure to allow it when prompted by your browser.

### WebSocket Connection
If you see "WebSocket closed" errors, check that your AWS credentials have permission to use Transcribe streaming.