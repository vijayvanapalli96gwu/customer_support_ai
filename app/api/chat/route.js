import { NextResponse } from 'next/server'; // Import NextResponse from Next.js for handling responses
import OpenAI from 'openai'; // Import OpenAI library for interacting with the OpenAI API
import { Pinecone } from '@pinecone-database/pinecone'; // Import Pinecone to store and query embeddings
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'; // Import PDFLoader for loading PDF files
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'; // Import RecursiveCharacterTextSplitter for splitting text
import { OpenAIEmbeddings } from '@langchain/openai'; // Import OpenAIEmbeddings for generating embeddings
import tiktoken from 'tiktoken'; // Import tiktoken for tokenization

// Initialize Pinecone client
const client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// Define the Pinecone index
const indexName = 'openaichatbot';
let index;

try {
  index = client.index(indexName);
  console.log(`Successfully connected to Pinecone index: ${indexName}`);
} catch (error) {
  console.error(`Error connecting to Pinecone index: ${error.message}`);
}

// Initialize the tokenizer
const tokenizer = tiktoken.get_encoding('p50k_base');

// Define the custom length function using tiktoken
function tiktoken_len(text) {
  const tokens = tokenizer.encode(text);
  return tokens.length;
}

// Function to load and process the PDF
async function loadAndProcessPDF(pdfPath) {
  
  console.log(`Loading PDF from path: ${pdfPath}`);
  const loader = new PDFLoader(pdfPath);
  const documents = await loader.load();
  console.log(`Successfully loaded PDF. Number of documents: ${documents.length}`);

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunk_size: 2000,
    chunk_overlap: 100,
    length_function: tiktoken_len,
  });
  const chunks = await textSplitter.splitDocuments(documents);
  console.log(`Successfully split documents into ${chunks.length} chunks.`);   
  console.log(Array.isArray(chunks)); // This should return `true` if `chunks` is an array

  //console.log(`/////////////////////`, [chunks[0].pageContent]);

    // Assuming `chunks` is an array of objects, each with a `page_content` property
  const embeddings = new OpenAIEmbeddings();
  // try {
    // Generate embeddings for all chunks
    const texts = chunks
    .map(doc => doc.pageContent)
    .filter(text => typeof text === 'string' && text.trim().length > 0); // Filter out invalid or empty strings

  // Log the texts to ensure they're valid
  //texts.forEach((text, index) => {
    //console.log(`Text chunk ${index}:`, text);
  //});

  if (texts.length === 0) {
    throw new Error('No valid text data to embed.');
  }

  // Optionally sanitize or split text here if needed
  const sanitizedTexts = texts.map(text => text.replace(/[^a-zA-Z0-9 .,?!]/g, ''));

  // Generate embeddings for all valid text chunks
  const docEmbeddings = await embeddings.embedDocuments(sanitizedTexts);
  console.log(`Generated ${docEmbeddings.length} document embeddings.`);
  console.log(Array.isArray(docEmbeddings));
    // Log the number of embeddings generated
  //console.log(`Generated ${docEmbeddings.length} document embeddings.`);
// } catch (error) {
  //   console.error('Error generating embeddings:', error);
  // }

  //Storing embedding vectors in pinecone
  const vectors = docEmbeddings.map((embedding, i) => ({
    id: String(i), // Ensure each vector has a unique ID
    values: embedding, // The actual embedding vector
    metadata: { text: texts[i] } // Add any metadata you want
  }));
  console.log(Array.isArray(vectors)); // checking vectors are array
  
  await index.upsert( vectors );
  console.log('Successfully upserted vectors into Pinecone.');
  
}

// Load and process the PDF when the server starts or on-demand

await loadAndProcessPDF('/public/pdf_files/Does The Recent Stock Market Crash Indicate A Recession In 2024?.pdf');


// System prompt for the AI
const systemPrompt = "You are an expert stock market assistant. Answer any questions about stock market provided. You always answer questions based only on the context that you have been provided.";

// Chat completion API call
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  
  console.log('Received POST request at /api/chat');
  const data = await req.json();
  console.log('Parsed request body:', data);

  const userMessage = data[data.length - 1].content;
  console.log('User message:', userMessage);

  const embeddings = new OpenAIEmbeddings();
  const queryEmbedding = await embeddings.embedQuery(userMessage);
  console.log('Generated query embedding. ', queryEmbedding);

  const result = await index.query({
    vector: queryEmbedding,
    topK: 5,
    includeMetadata: true,
  });
  console.log('Queried Pinecone for similar chunks:', result);

  const matchedTexts = result.matches.map(match => match.metadata.text).join('\n');
  console.log('Matched texts:', matchedTexts);

  const completion = await openai.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${matchedTexts}\n\nQ: ${userMessage}\nA:` },
    ],
    model: 'gpt-4o',
    stream: true,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const chunk of completion) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            const text = encoder.encode(content);
            controller.enqueue(text);
          }
        }
      } catch (err) {
        console.error('Error during streaming response:', err.message);
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  console.log('Returning streaming response.');
  return new NextResponse(stream);

}
