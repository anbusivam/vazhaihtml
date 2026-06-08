// Netlify Function: POST /blog/upload-image
// Accepts a file upload from Editor.js Image plugin, forwards to Cloudinary unsigned upload
// Returns Editor.js-compatible response format
const { handleOptions, CORS_HEADERS } = require('./blog-auth');

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || '';

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET env vars.' }),
    };
  }

  try {
    // Editor.js sends the file as multipart form-data
    const contentType = event.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Expected multipart/form-data' }),
      };
    }

    // Parse the multipart body to extract the file
    // Netlify functions receive the body as base64 when isBase64Encoded is true
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body);

    // We need to parse multipart manually or use a simple approach
    // Since we know Editor.js sends the file as "image" field, extract it
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No boundary in content-type' }),
      };
    }

    // Extract file parts from multipart body
    const parts = parseMultipart(bodyBuffer, boundary.trim());
    const imagePart = parts.find(p => p.fieldName === 'image');
    
    if (!imagePart || !imagePart.data) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'No image file found in upload' }),
      };
    }

    // Upload to Cloudinary using unsigned upload preset
    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

    // Create form data for Cloudinary
    const formDataBoundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const formDataParts = [];

    // Add upload preset
    formDataParts.push(
      `--${formDataBoundary}\r\n` +
      `Content-Disposition: form-data; name="upload_preset"\r\n\r\n` +
      `${CLOUDINARY_UPLOAD_PRESET}\r\n`
    );

    // Add the file
    const fileName = imagePart.filename || 'upload.jpg';
    formDataParts.push(
      `--${formDataBoundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${imagePart.contentType || 'application/octet-stream'}\r\n\r\n`
    );

    const formDataHeader = Buffer.from(formDataParts[0], 'utf-8');
    const formDataFileHeader = Buffer.from(formDataParts[1], 'utf-8');
    const formDataFooter = Buffer.from(`\r\n--${formDataBoundary}--\r\n`, 'utf-8');

    const cloudinaryBody = Buffer.concat([
      formDataHeader,
      formDataFileHeader,
      imagePart.data,
      formDataFooter,
    ]);

    const cloudinaryRes = await fetch(cloudinaryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${formDataBoundary}`,
      },
      body: cloudinaryBody,
    });

    if (!cloudinaryRes.ok) {
      const errText = await cloudinaryRes.text();
      console.error('[blog-image-upload] Cloudinary error:', cloudinaryRes.status, errText);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Cloudinary upload failed' }),
      };
    }

    const cloudinaryData = await cloudinaryRes.json();

    // Return Editor.js-compatible response
    // https://editorjs.io/image-tool-configuration/#custom-uploader
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: 1,
        file: {
          url: cloudinaryData.secure_url || cloudinaryData.url,
        },
      }),
    };
  } catch (err) {
    console.error('[blog-image-upload] Exception:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Server error: ' + err.message }),
    };
  }
};

// Simple multipart form-data parser for Node.js
function parseMultipart(buffer, boundary) {
  const boundaryBytes = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    // Find next boundary
    const bIdx = buffer.indexOf(boundaryBytes, start);
    if (bIdx === -1) break;

    const partStart = bIdx + boundaryBytes.length;
    
    // Check if this is the closing boundary
    if (buffer[partStart] === 0x2d && buffer[partStart + 1] === 0x2d) break; // "--"
    
    // Skip \r\n after boundary
    let contentStart = partStart;
    if (buffer[contentStart] === 0x0d) contentStart += 1;
    if (buffer[contentStart] === 0x0a) contentStart += 1;

    // Find double \r\n separating headers from body
    const headerEnd = buffer.indexOf('\r\n\r\n', contentStart);
    if (headerEnd === -1) break;

    const headerSection = buffer.slice(contentStart, headerEnd).toString('utf-8');
    const dataStart = headerEnd + 4;

    // Find next boundary to know where this part ends
    const nextBIdx = buffer.indexOf(boundaryBytes, dataStart);
    const partEnd = nextBIdx !== -1 ? nextBIdx - 2 : buffer.length; // -2 to remove trailing \r\n

    // Parse headers
    const fieldName = extractHeaderValue(headerSection, 'name');
    const filename = extractHeaderValue(headerSection, 'filename');
    const contentType = extractContentType(headerSection);

    parts.push({
      fieldName,
      filename,
      contentType,
      data: buffer.slice(dataStart, partEnd),
    });

    start = nextBIdx !== -1 ? nextBIdx + boundaryBytes.length : buffer.length;
  }

  return parts;
}

function extractHeaderValue(headerSection, attr) {
  const regex = new RegExp(`${attr}="([^"]*)"`);
  const match = headerSection.match(regex);
  return match ? match[1] : null;
}

function extractContentType(headerSection) {
  const match = headerSection.match(/Content-Type:\s*([^\r\n]+)/i);
  return match ? match[1].trim() : null;
}