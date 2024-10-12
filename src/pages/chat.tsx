import { useState, useRef } from 'react';
import Head from 'next/head';

export default function Chat() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]); // Define the type of messages
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null); // Specify the type of the ref

  const playAudio = async (audioData: string, audioMimeType: string, fallbackText: string) => {
    try {
      console.log("Attempting to play audio, length:", audioData.length);

      // Convert base64 to ArrayBuffer
      const binaryString = atob(audioData);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log("Converted to Uint8Array, length:", bytes.length);
      console.log("First 20 bytes:", bytes.slice(0, 20));
      console.log("Last 20 bytes:", bytes.slice(-20));

      // Convert PCM to WAV
      const wavBuffer = createWavFromPcm(bytes);

      // Create blob and URL
      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(blob);

      // Create audio element and play
      const audio = new Audio(audioUrl);
      
      audio.oncanplay = () => {
        console.log('Audio can be played');
        audio.play().catch(e => console.error('Error playing audio:', e));
      };

      audio.onended = () => {
        console.log('Audio playback finished');
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = (e) => {
        console.error('Audio error:', e);
        // Fallback to speech synthesis
        const utterance = new SpeechSynthesisUtterance(fallbackText);
        window.speechSynthesis.speak(utterance);
      };

    } catch (error) {
      console.error('Error setting up audio playback:', error);
      // Fallback: Use browser's built-in speech synthesis
      const utterance = new SpeechSynthesisUtterance(fallbackText);
      window.speechSynthesis.speak(utterance);
    }
  };

  function createWavFromPcm(pcmData: Uint8Array): ArrayBuffer {
    const numChannels = 1; // Mono
    const sampleRate = 24000; // Assuming 24kHz sample rate, adjust if needed
    const bitsPerSample = 16; // Assuming 16-bit PCM, adjust if needed

    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // ByteRate
    view.setUint16(32, numChannels * (bitsPerSample / 8), true); // BlockAlign
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.length, true);

    // Combine header and PCM data
    const wavBuffer = new Uint8Array(wavHeader.byteLength + pcmData.length);
    wavBuffer.set(new Uint8Array(wavHeader), 0);
    wavBuffer.set(pcmData, wavHeader.byteLength);

    return wavBuffer.buffer;
  }

  function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  const sendMessage = async () => {
    if (input.trim()) {
      const userMessage = { role: 'user', content: input };
      setMessages(prevMessages => [...prevMessages, userMessage]);
      setIsLoading(true);
      setInput('');

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: userMessage.content }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.error) {
          throw new Error(data.error);
        }

        console.log("Received data:", {
          response: data.response,
          audioDataLength: data.audioData ? data.audioData.length : 0,
          audioMimeType: data.audioMimeType
        });

        const assistantMessage = { role: 'assistant', content: data.response };
        setMessages(prevMessages => [...prevMessages, assistantMessage]);
        
        // Play the audio
        if (data.audioData && data.audioMimeType) {
          console.log("Audio data received, length:", data.audioData.length);
          await playAudio(data.audioData, data.audioMimeType, data.response);
        } else {
          console.warn('No audio data received');
          // Fallback: Use browser's built-in speech synthesis
          const utterance = new SpeechSynthesisUtterance(data.response);
          window.speechSynthesis.speak(utterance);
        }
      } catch (error: unknown) {
        console.error('Error:', error);
        let errorMessage = 'An unknown error occurred';
        if (error instanceof Error) {
          errorMessage = error.message;
          console.error('Error name:', error.name);
          console.error('Error message:', error.message);
          console.error('Error stack:', error.stack);
        }
        setMessages(prevMessages => [...prevMessages, { role: 'assistant', content: `Error: ${errorMessage}` }]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="bg-gray-900 min-h-screen text-white">
      <Head>
        <title>OpenAI Chat</title>
        <meta name="description" content="Real-time chat with OpenAI GPT-4" />
      </Head>
      <main className="container mx-auto p-4">
        <h1 className="text-3xl font-bold mb-4">Chat with GPT-4</h1>
        <div className="bg-gray-800 rounded-lg p-4 h-[60vh] overflow-y-auto mb-4">
          {messages.map((message, index) => (
            <div key={index} className={`mb-2 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
              <span className={`inline-block p-2 rounded-lg ${message.role === 'user' ? 'bg-blue-600' : 'bg-green-600'}`}>
                {message.content}
              </span>
            </div>
          ))}
          {isLoading && <div className="text-center">Loading...</div>}
          <div ref={messagesEndRef} />
        </div>
        <div className="flex">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-grow bg-gray-700 text-white p-2 rounded-l-lg focus:outline-none"
            placeholder="Type your message..."
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            className="bg-blue-600 text-white p-2 rounded-r-lg hover:bg-blue-700 focus:outline-none"
            disabled={isLoading}
          >
            Send
          </button>
        </div>
      </main>
    </div>
  );
}
