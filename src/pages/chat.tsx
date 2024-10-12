import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import pako from 'pako';

export default function Chat() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [userVolume, setUserVolume] = useState(0);
  const [aiVolume, setAIVolume] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isWaitingToSend, setIsWaitingToSend] = useState(false);

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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const audioChunks: Blob[] = [];

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const updateVolume = () => {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const volume = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        setUserVolume(volume);
        if (isRecording) {
          animationFrameRef.current = requestAnimationFrame(updateVolume);
        }
      };

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        setAudioBlob(audioBlob);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        setUserVolume(0);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setIsWaitingToSend(false);
      updateVolume();
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleUserCircleClick = () => {
    if (!isRecording && !isWaitingToSend) {
      // First click: Start recording
      startRecording();
    } else if (isRecording) {
      // Second click: Stop recording and prepare to send
      stopRecording();
      setIsWaitingToSend(true);
    } else if (isWaitingToSend) {
      // Third click (or second click after a delay): Send the audio
      sendAudioMessage();
      setIsWaitingToSend(false);
    }
  };

  const sendAudioMessage = async () => {
    if (audioBlob) {
      setIsLoading(true);
      try {
        console.time('audioProcessing');
        console.log('Starting audio processing');
        const arrayBuffer = await audioBlob.arrayBuffer();
        console.log('ArrayBuffer created, size:', arrayBuffer.byteLength);

        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('AudioContext created');

        console.time('decodeAudioData');
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.timeEnd('decodeAudioData');
        console.log('Audio decoded, duration:', audioBuffer.duration);

        const channelData = audioBuffer.getChannelData(0);
        console.log('Channel data extracted, length:', channelData.length);

        console.time('base64Encode');
        const base64AudioData = base64EncodeAudio(channelData);
        console.timeEnd('base64Encode');
        console.log('Audio data encoded to base64, length:', base64AudioData.length);

        console.time('compression');
        const compressedData = pako.deflate(base64AudioData);
        console.timeEnd('compression');
        console.log('Data compressed, size:', compressedData.length);

        console.time('compressedBase64');
        const compressedBase64 = btoa(new Uint8Array(compressedData).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        console.timeEnd('compressedBase64');
        console.log('Compressed data encoded to base64, length:', compressedBase64.length);

        console.timeEnd('audioProcessing');
        console.log('Audio processing completed, sending to server');

        console.time('serverRequest');
        await sendMessage(compressedBase64, true);
        console.timeEnd('serverRequest');
      } catch (error: unknown) {
        console.error('Error processing audio:', error);
        let errorMessage = 'An error occurred while processing the audio';
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        setMessages(prevMessages => [...prevMessages, { role: 'assistant', content: `Error: ${errorMessage}` }]);
      } finally {
        setIsLoading(false);
        setAudioBlob(null);
        setIsWaitingToSend(false);
      }
    } else {
      console.warn('No audio blob available to send');
      setIsWaitingToSend(false);
    }
  };

  function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function base64EncodeAudio(float32Array: Float32Array): string {
    const buffer = floatTo16BitPCM(float32Array);
    return btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
  }

  const sendMessage = async (content: string, isAudio: boolean = false) => {
    setIsLoading(true);
    try {
      console.time('apiRequest');
      console.log('Sending request to API');
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: isAudio ? undefined : content,
          audioData: isAudio ? content : undefined,
          isCompressed: isAudio
        }),
      });
      console.timeEnd('apiRequest');
      console.log('API response received');

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.time('jsonParse');
      const data = await response.json();
      console.timeEnd('jsonParse');
      console.log('Response data parsed');

      if (data.error) {
        throw new Error(data.error);
      }

      console.log("Received data:", {
        responseLength: data.response.length,
        audioDataLength: data.audioData ? data.audioData.length : 0,
        audioMimeType: data.audioMimeType
      });

      const assistantMessage = { role: 'assistant', content: data.response };
      setMessages(prevMessages => [...prevMessages, 
        isAudio ? { role: 'user', content: 'Sent audio message' } : { role: 'user', content },
        assistantMessage
      ]);
      
      if (data.audioData && data.audioMimeType) {
        console.log("Audio data received, length:", data.audioData.length);
        setIsAISpeaking(true);
        simulateAISpeaking();
        console.time('audioPlayback');
        await playAudio(data.audioData, data.audioMimeType, data.response);
        console.timeEnd('audioPlayback');
        setIsAISpeaking(false);
      } else {
        console.warn('No audio data received');
        // Fallback: Use browser's built-in speech synthesis
        const utterance = new SpeechSynthesisUtterance(data.response);
        setIsAISpeaking(true);
        simulateAISpeaking();
        utterance.onend = () => {
          setIsAISpeaking(false);
          setAIVolume(0);
        };
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
      setInput('');
    }
  };

  const simulateAISpeaking = () => {
    let frame = 0;
    const animate = () => {
      frame++;
      const volume = Math.sin(frame / 5) * 50 + 50; // Oscillate between 0 and 100
      setAIVolume(volume);
      if (isAISpeaking) {
        requestAnimationFrame(animate);
      } else {
        setAIVolume(0);
      }
    };
    animate();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input);
    }
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div className="bg-gray-900 min-h-screen text-white flex items-center justify-center">
      <Head>
        <title>AI Chat Circles</title>
        <meta name="description" content="Chat with AI using interactive circles" />
      </Head>
      <main className="container mx-auto p-4 flex flex-col items-center">
        <h1 className="text-3xl font-bold mb-8">AI Chat Circles</h1>
        <div className="flex justify-between w-full max-w-2xl mb-8">
          <div 
            className={`w-48 h-48 rounded-full flex items-center justify-center cursor-pointer transition-all duration-100 ${
              isRecording ? 'bg-red-600' : isWaitingToSend ? 'bg-yellow-600' : 'bg-blue-600 hover:bg-blue-700'
            }`}
            onClick={handleUserCircleClick}
            style={{
              transform: `scale(${1 + userVolume / 200})`,
              boxShadow: `0 0 ${userVolume}px ${userVolume / 2}px rgba(59, 130, 246, 0.5)`
            }}
          >
            <span className="text-xl font-bold">
              {isRecording ? 'Recording...' : isWaitingToSend ? 'Click to Send' : 'Click to Speak'}
            </span>
          </div>
          <div 
            className={`w-48 h-48 rounded-full flex items-center justify-center transition-all duration-100 ${
              isAISpeaking ? 'bg-green-600' : 'bg-gray-600'
            }`}
            style={{
              transform: `scale(${1 + aiVolume / 200})`,
              boxShadow: `0 0 ${aiVolume}px ${aiVolume / 2}px rgba(16, 185, 129, 0.5)`
            }}
          >
            <span className="text-xl font-bold">
              {isAISpeaking ? 'AI Speaking...' : 'AI'}
            </span>
          </div>
        </div>
        <div className="w-full max-w-2xl bg-gray-800 rounded-lg p-4 mb-4 h-64 overflow-y-auto">
          {messages.map((message, index) => (
            <div key={index} className={`mb-2 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
              <span className={`inline-block p-2 rounded-lg ${message.role === 'user' ? 'bg-blue-600' : 'bg-green-600'}`}>
                {message.content}
              </span>
            </div>
          ))}
          {isLoading && <div className="text-center">Processing...</div>}
        </div>
        <form onSubmit={handleSubmit} className="w-full max-w-2xl flex">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-grow bg-gray-700 text-white p-2 rounded-l-lg focus:outline-none"
            placeholder="Type your message..."
            disabled={isLoading || isRecording}
          />
          <button
            type="submit"
            className="bg-blue-600 text-white p-2 rounded-r-lg hover:bg-blue-700 focus:outline-none"
            disabled={isLoading || isRecording}
          >
            Send
          </button>
        </form>
      </main>
    </div>
  );
}