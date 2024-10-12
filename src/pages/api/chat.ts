import { NextApiRequest, NextApiResponse } from 'next';
import WebSocket from 'ws';
import pako from 'pako';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { message, audioData, isCompressed, chunkIndex, totalChunks } = req.body;

    const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
    const ws = new WebSocket(url, {
      headers: {
        "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    let response = '';
    let audioChunks: Buffer[] = [];
    let hasResponded = false;

    const sendResponse = () => {
      if (!hasResponded) {
        hasResponded = true;
        const audioBuffer = Buffer.concat(audioChunks);
        console.log("Sending response:", response); // Add this line
        console.log("Sending audio data, length:", audioBuffer.length);
        console.log("First 20 bytes of audio data:", audioBuffer.slice(0, 20).toString('hex'));
        console.log("Last 20 bytes of audio data:", audioBuffer.slice(-20).toString('hex'));
        res.status(200).json({ 
          response: response, // Remove the fallback 'No response received'
          audioData: audioBuffer.toString('base64'),
          audioMimeType: determineAudioMimeType(audioBuffer) // Use the helper function
        });
      }
    };

    // Helper function to determine MIME type
    function determineAudioMimeType(buffer: Buffer): string {
      const header = buffer.slice(0, 4).toString('hex');
      console.log("Audio header:", header);
      if (header.startsWith('fff3') || header.startsWith('fff2')) return 'audio/mpeg';
      if (header.startsWith('5249')) return 'audio/wav'; // "RIFF" in hex
      if (header.startsWith('4f676753')) return 'audio/ogg';
      if (header.startsWith('664c6143')) return 'audio/flac'; // "fLaC" in hex
      return 'audio/mp3'; // Default to MP3 if unknown
    }

    // Set a timeout to ensure we always send a response
    const timeout = setTimeout(() => {
      console.log("Timeout reached, closing WebSocket");
      ws.close();
      sendResponse();
    }, 10000); // 10 seconds timeout

    ws.on("open", function open() {
      console.log("Connected to server.");
      
      let processedAudioData = audioData;
      if (isCompressed) {
        // Decompress the data
        const compressedData = Uint8Array.from(atob(audioData), c => c.charCodeAt(0));
        const decompressedData = pako.inflate(compressedData);
        processedAudioData = new TextDecoder().decode(decompressedData);
      }

      // Send user message or audio
      const userEvent = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: processedAudioData
            ? [
                {
                  type: 'input_audio',
                  audio: processedAudioData
                }
              ]
            : [
                {
                  type: 'input_text',
                  text: message
                }
              ]
        }
      };
      ws.send(JSON.stringify(userEvent));

      // Request response
      ws.send(JSON.stringify({type: 'response.create'}));
    });

    ws.on("message", function incoming(data) {
      const parsedData = JSON.parse(data.toString());
      console.log("Received message type:", parsedData.type);
      
      if (parsedData.type === 'error') {
        console.error("API Error:", parsedData.error);
        clearTimeout(timeout);
        ws.close();
        res.status(500).json({ error: parsedData.error.message });
        return;
      }
      if (parsedData.type === 'conversation.item.create' && parsedData.item.role === 'assistant') {
        response += parsedData.item.content[0].text;
      }
      if (parsedData.type === 'response.audio.delta') {
        const chunk = Buffer.from(parsedData.delta, 'base64');
        audioChunks.push(chunk);
        console.log("Received audio chunk, length:", chunk.length);
      }
      if (parsedData.type === 'response.end') {
        clearTimeout(timeout);
        ws.close();
        sendResponse();
      }
    });

    ws.on("close", function close() {
      console.log("WebSocket closed");
      clearTimeout(timeout);
      sendResponse();
    });

    ws.on("error", function error(err) {
      console.error("WebSocket error:", err);
      clearTimeout(timeout);
      if (!hasResponded) {
        res.status(500).json({ error: 'WebSocket error occurred' });
      }
    });
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
