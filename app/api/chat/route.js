import {NextResponse} from 'next/server' // Import NextResponse from Next.js for handling responses
import OpenAI from 'openai' // Import OpenAI library for interacting with the OpenAI API

// System prompt for the AI, providing guidelines on how to respond to users
const systemPrompt = "You are a helpful customer support assistant. Answer user questions in a polite and friendly manner."// we can change this later

//Chat completion API call
// POST function to handle incoming requests
export async function POST(req) {
  const openai = new OpenAI() // Create a new instance of the OpenAI client
  const data = await req.json() // Parse the JSON body of the incoming request

  // Create a chat completion request to the OpenAI API
  const completion = await openai.chat.completions.create({
    messages: [{role: 'system', content: systemPrompt}, ...data], // Include the system prompt and user messages
    model: 'gpt-4o', // Specify the model to use
    stream: true, // Enable streaming responses
  })

  /**This part of the code sets up a ReadableStream to handle a streaming response from the OpenAI API, processes each chunk of data as it arrives, encodes the data, and enqueues it to the stream. It handles errors gracefully and ensures the stream is properly closed when done. The final stream is then returned as an HTTP response using NextResponse. */
  // Create a ReadableStream to handle the streaming response (ReadableStream is a web API that allows you to create a stream of data that can be read incrementally.)
  const stream = new ReadableStream({
    async start(controller) { //start method is called when the stream is about to be read
      const encoder = new TextEncoder() // Create a TextEncoder to convert strings to Uint8Array
      try {
        // Iterate over the streamed chunks of the response from OPENAI API
        for await (const chunk of completion) {
          const content = chunk.choices[0]?.delta?.content // Extract the content from the chunk
          if (content) {
            const text = encoder.encode(content) // Encode the content to Uint8Array
            controller.enqueue(text) // Enqueue the encoded text to the stream (This makes the data available to be read from the stream)
          }
        }
      } catch (err) {
        controller.error(err) // Handle any errors that occur during streaming
      } finally {
        controller.close() // Close the stream when done
      }
    },
  })

  return new NextResponse(stream) // Return the stream as the HTTP response
}