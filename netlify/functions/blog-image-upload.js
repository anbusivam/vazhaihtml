// Netlify Function: POST /blog/upload-image
// Accepts a file upload from Editor.js Image plugin, forwards to Cloudinary signed upload
// Returns Editor.js-compatible response format
const { handleOptions, CORS_HEADERS } = require('./blog-auth');
const crypto = require('crypto');

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || '';
const CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || '';

exports.handler = async function (event, context) {
  const optPre = handleOptions(event);
  if (optPre) return optPre;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_KEY || !CLOUDINARY_SECRET) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_KEY, and CLOUDINARY_SECRET env vars.' }),
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
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body);

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

    // Generate signed upload to Cloudinary
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'blog'; // Optional: organize blog uploads in a folder
    
    // Build signature string: sort params alphabetically, concatenate as key=value&key2=value2
    const paramsToSign = {
      timestamp,
      folder,
    };
    
    // Sort keys alphabetically and build signature string
    const sortedKeys = Object.keys(paramsToSign).sort();
    const signString = sortedKeys.map(k => `${k}=${paramsToSign[k]}`).join('&') + CLOUDINARY_SECRET;
    const signature = crypto.createHash('sha1').update(signString).digest('hex');

    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

    // Create form data for Cloudinary
    const formDataBoundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const formDataParts = [];

    // Add api_key
    formDataParts.push(
      `--${formDataBoundary}\r\n` +
      `Content-Disposition: form-data; name="api_key"\r\n\r\n` +
      `${CLOUDINARY_KEY}\r\n`
    );

    // Add timestamp
    formDataParts.push(
      `--${formDataBoundary}\r\n` +
      `Content-Disposition: form-data; name="timestamp"\r\n\r\n` +
      `${timestamp}\r\n`
    );

    // Add folder
    formDataParts.push(
      `--${formDataBoundary}\r\n` +
      `Content-Disposition: form-data; name="folder"\r\n\r\n` +
      `${folder}\r\n`
    );

    // Add signature
    formDataParts.push(
      `--${formDataBoundary}\r\n` +
      `Content-Disposition: form-data; name="signature"\r\n\r\n` +
      `${signature}\r\n`
    );

    // Add the file
    const fileName = imagePart.filename || 'upload.jpg';
    formDataParts.push(
      `--${formDataBoundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${imagePart.contentType || 'application/octet-stream'}\r\n\r\n`
    );

    const formDataHeader1 = Buffer.from(formDataParts[0], 'utf-8');
    const formDataHeader2 = Buffer.from(formDataParts[1], 'utf-8');
    const formDataHeader3 = Buffer.from(formDataParts[2], 'utf-8');
    const formDataHeader4 = Buffer.from(formDataParts[3], 'utf-8');
    const formDataFileHeader = Buffer.from(formDataParts[4], 'utf-8');
    const formDataFooter = Buffer.from(`\r\n--${formDataBoundary}--\r\n`, 'utf-8');

    const cloudinaryBody = Buffer.concat([
      formDataHeader1,
      formDataHeader2,
      formDataHeader3,
      formDataHeader4,
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
        body: JSON.stringify({ error: 'Cloudinary upload failed: ' + errText }),
      };
    }

    const cloudinaryData = await cloudinaryRes.json();

    // Return Editor.js-compatible response
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
    const bIdx = buffer.indexOf(boundaryBytes, start);
    if (bIdx === -1) break;

    const partStart = bIdx + boundaryBytes.length;
    
    // Check if this is the closing boundary
    if (buffer[partStart] === 0x2d && buffer[partStart + 1] === 0x2d) break;
    
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
    const partEnd = nextBIdx !== -1 ? nextBIdx - 2 : buffer.length;

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