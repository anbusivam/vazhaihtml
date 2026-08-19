// Netlify Function: GET /razorpay/receipt-pdf?paymentId=pay_xxxxxx
// Authenticated user: Generates and downloads a PDF receipt for a payment
const PDFDocument = require('pdfkit');
const path = require('path');
const https = require('https');
const { getStore, ADMIN_EMAILS } = require('./auth-store');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Path to the Noto Sans Tamil font for Unicode/Tamil text rendering
const TAMIL_FONT_PATH = path.resolve(__dirname, '..', 'fonts', 'NotoSansTamil-Regular.ttf');

async function getSession(store, event) {
  const cookies = event.headers['cookie'] || '';
  const authHeader = event.headers['authorization'] || '';

  let token = null;
  const match = cookies.match(/vazhai_session=([^;]+)/);
  if (match) token = match[1];
  if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token) return null;

  const session = await store.get(`session:${token}`, { type: 'json' });
  if (!session || Date.now() > session.expiresAt) return null;
  return session;
}

/**
 * Get user profile from store, with fallback to session data.
 */
async function getUserProfile(store, email) {
  try {
    const userData = await store.get(`user:${email}`, { type: 'json' });
    return userData || {};
  } catch (_) {
    return {};
  }
}

/**
 * Format a number as Indian currency string.
 * Uses "Rs." instead of the ₹ symbol because the PDF's Helvetica font
 * does not include the ₹ glyph (U+20B9), which would render as a
 * garbled superscript-like character (e.g. "¹24,000.00").
 */
function formatINR(amount) {
  return 'Rs. ' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format a date from various formats to a nice readable format
 */
function formatDate(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Convert payment status to a human-readable label
 */
function statusLabel(status) {
  const map = {
    captured: 'Completed',
    authorized: 'Authorized',
    failed: 'Failed',
    refunded: 'Refunded',
  };
  return map[status] || status || 'Unknown';
}

/**
 * Detect if a string contains non-ASCII characters (Unicode beyond latin-1).
 */
function hasUnicode(str) {
  if (!str) return false;
  return /[^\x00-\xFF]/.test(str);
}

/**
 * Fetch logo image: try local filesystem first, then HTTPS from the website.
 * Returns a Buffer if successful, or null if both attempts fail.
 */
async function fetchLogoBuffer() {
  const fs = require('fs');
  const localPath = path.resolve(__dirname, '../../images/vazahi-logo.jpg');

  // Try local filesystem first (works in local dev and some Netlify deployments)
  try {
    const data = fs.readFileSync(localPath);
    if (data && data.length > 100) return data;
  } catch (_) {
    // Fall through to HTTPS attempt
  }

  // Fallback: fetch from website URL (reliable on Netlify where static assets are served)
  try {
    return await new Promise((resolve, reject) => {
      const url = 'https://vazhai.in/images/vazahi-logo.jpg';
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  } catch (_) {
    return null;
  }
}

/**
 * Generate the PDF receipt as a Buffer.
 * Uses a clean NGO-style receipt template with Vazhai branding.
 */
function generateReceiptPDF({ userName, userEmail, userAddress, userPan, payment, logoBuffer }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Vazhai Donation Receipt - ${payment.paymentId}`,
          Author: 'Vazhai NGO',
          Subject: 'Donation Receipt',
        },
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // ── Register Unicode font for Tamil/Unicode text ──
      let hasUnicodeFont = false;
      try {
        doc.registerFont('NotoSansTamil', TAMIL_FONT_PATH);
        hasUnicodeFont = true;
      } catch (_) {
        // Font file not found, will fall back to Helvetica
      }

      // ── Colors ──
      const greenDark = '#2d5a3f';
      const green = '#4a7c59';
      const textColor = '#333333';
      const lightGray = '#f5f5f5';
      const borderGray = '#dddddd';

      // ── Header: Decorative top bar ──
      doc.rect(0, 0, doc.page.width, 8).fill(greenDark);
      doc.rect(0, doc.page.height - 8, doc.page.width, 8).fill(greenDark);

      // ── Logo & Organization Name ──
      // Try to load logo from pre-fetched buffer, then fall back to local file path
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, 50, 28, { width: 60 });
        } catch (_) {
          // Skip logo if buffer is invalid
        }
      } else {
        const logoPath = __dirname + '/../../images/vazahi-logo.jpg';
        try {
          doc.image(logoPath, 50, 28, { width: 60 });
        } catch (_) {
          // Logo file not found, just skip it
        }
      }

      doc.fontSize(22).font('Helvetica-Bold').fillColor(greenDark)
        .text('VAZHAI', 120, 38);
      doc.fontSize(10).font('Helvetica').fillColor('#666')
        .text('NGO Reg. No. 296/05, Tamil Nadu', 120, 63);
      doc.fontSize(9).font('Helvetica').fillColor('#888')
        .text('# 341/157, T.H. Road, Kaladipet, Thiruvottiyur, Chennai – 600 019', 120, 79);

      // ── Receipt Title ──
      doc.moveTo(120, 108).lineTo(545, 108).strokeColor(borderGray).lineWidth(1).stroke();

      doc.fontSize(18).font('Helvetica-Bold').fillColor(greenDark)
        .text('DONATION RECEIPT', 50, 123, { align: 'center' });

      // ── Receipt Number & Date line ──
      doc.moveTo(50, 152).lineTo(545, 152).strokeColor(borderGray).lineWidth(1).stroke();

      const receiptId = (payment.receiptNo && payment.receiptNo.trim()) ? payment.receiptNo : (payment.paymentId || '—');
      const receiptDate = formatDate(payment.createdAtDate || payment.createdAt * 1000);

      doc.fontSize(10).font('Helvetica-Bold').fillColor(textColor);
      doc.text('Receipt No:', 50, 164, { continued: true });
      doc.font('Helvetica').fillColor('#555').text(`  ${receiptId}`, { continued: true });

      doc.font('Helvetica-Bold').fillColor(textColor)
        .text('    Date:', { continued: true });
      doc.font('Helvetica').fillColor('#555').text(`  ${receiptDate}`);

      // ── Donor Details Section ──
      doc.moveTo(50, 192).lineTo(545, 192).strokeColor(borderGray).lineWidth(0.5).stroke();
      doc.rect(50, 197, 495, 18).fill(green);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff')
        .text('DONOR DETAILS', 55, 200);

      // Render mixed Tamil+English text with per-word font switching.
      // Each word is measured via widthOfString and rendered at calculated
      // (cx, cy). Position tracking uses widthOfString exclusively to avoid
      // font-metric mismatch from doc.x after rendering. Each font gets its
      // own subset, so Latin glyphs in Helvetica and Tamil in NotoSansTamil
      // are both independently embedded correctly.
      function renderMixedText(doc, text, x, y, opts) {
        if (!text || text === '—') {
          doc.fontSize(10).font('Helvetica').fillColor('#555').text('—', x, y, opts || {});
          return;
        }
        opts = opts || {};
        doc.fontSize(10).fillColor('#555');
        const maxWidth = opts.width || Infinity;
        const lineHeight = 16;
        let cx = x;
        let cy = y;

        // Process each line for multiline support
        const lines = text.split('\n');
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          if (li > 0) { cx = x; cy += lineHeight; }
          if (!line) continue;

          // Split into words (preserving whitespace as tokens for spacing)
          const tokens = line.match(/\S+|\s+/g) || [line];
          if (tokens.length === 0) continue;

          for (const token of tokens) {
            const isUnicode = hasUnicodeFont && /[^\x00-\xFF]/.test(token);
            doc.font(isUnicode ? 'NotoSansTamil' : 'Helvetica');
            const w = doc.widthOfString(token);

            // Word-wrap: if word exceeds maxWidth, move to next line
            if (cx + w > x + maxWidth && cx > x) {
              cy += lineHeight;
              cx = x;
            }

            // Render word at calculated position. Each word renders independently
            // at an absolute (cx, cy), so there's no cross-font baseline issue.
            doc.text(token, cx, cy);

            // Advance position using measured width
            cx += w;
          }
        }
      }

      function donorLabel(label, x, y) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor(textColor).text(label, x, y);
      }

      function donorValue(text, x, y, opts) {
        renderMixedText(doc, text, x, y, opts, 16);
      }

      const donorY = 224;
      donorLabel('Name:', 55, donorY);
      donorValue(userName, 110, donorY);

      donorLabel('Email:', 55, donorY + 20);
      donorValue(userEmail, 110, donorY + 20);

      donorLabel('PAN:', 55, donorY + 40);
      donorValue(userPan, 110, donorY + 40);

      donorLabel('Address:', 55, donorY + 60);
      donorValue(userAddress, 110, donorY + 60, { width: 400 });

      // ── Payment Details Section ──
      const paymentSectionY = donorY + 110;
      doc.moveTo(50, paymentSectionY - 10).lineTo(545, paymentSectionY - 10).strokeColor(borderGray).lineWidth(0.5).stroke();
      doc.rect(50, paymentSectionY, 495, 18).fill(green);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff')
        .text('PAYMENT DETAILS', 55, paymentSectionY + 3);

      const payY = paymentSectionY + 28;
      doc.fontSize(10).font('Helvetica-Bold').fillColor(textColor)
        .text('Payment ID:', 55, payY);
      doc.font('Helvetica').fillColor('#555')
        .text(payment.paymentId || '—', 150, payY);

      doc.font('Helvetica-Bold').fillColor(textColor)
        .text('Order ID:', 55, payY + 20);
      doc.font('Helvetica').fillColor('#555')
        .text(payment.orderId || '—', 150, payY + 20);

      doc.font('Helvetica-Bold').fillColor(textColor)
        .text('Amount Donated:', 55, payY + 40);
      doc.font('Helvetica-Bold').fillColor(greenDark).fontSize(14)
        .text(formatINR(payment.amount), 150, payY + 37);

      doc.fontSize(10).font('Helvetica-Bold').fillColor(textColor)
        .text('Payment Method:', 55, payY + 62);
      doc.font('Helvetica').fillColor('#555')
        .text((payment.method || '—').toUpperCase(), 150, payY + 62);

      doc.font('Helvetica-Bold').fillColor(textColor)
        .text('Status:', 55, payY + 82);
      doc.font('Helvetica').fillColor(greenDark)
        .text(statusLabel(payment.status), 150, payY + 82);

      doc.font('Helvetica-Bold').fillColor(textColor)
        .text('Payment Date:', 55, payY + 102);
      doc.font('Helvetica').fillColor('#555')
        .text(receiptDate, 150, payY + 102);

      // ── Payment Gateway Note ──
      const gatewayY = payY + 130;
      doc.moveTo(50, gatewayY).lineTo(545, gatewayY).strokeColor(borderGray).lineWidth(0.5).stroke();
      doc.rect(50, gatewayY + 5, 495, 16).fill(lightGray);
      doc.fontSize(8).font('Helvetica').fillColor('#888')
        .text('Processed securely through Razorpay Payment Gateway', 55, gatewayY + 8);

      // ── Footer: Thank you message & address ──
      const footerY = gatewayY + 40;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(greenDark)
        .text('Thank you for your generous contribution!', 50, footerY, { align: 'center' });

      doc.fontSize(9).font('Helvetica').fillColor('#666')
        .text('Your donation supports educational equality for underprivileged children in rural Tamil Nadu.', 50, footerY + 22, { align: 'center', width: 495 });

      doc.moveTo(50, footerY + 55).lineTo(545, footerY + 55).strokeColor(borderGray).lineWidth(0.5).stroke();
      doc.fontSize(8).font('Helvetica').fillColor('#999')
        .text('Vazhai NGO | # 341/157, T.H. Road, Kaladipet, Thiruvottiyur, Chennai – 600 019', 50, footerY + 62, { align: 'center' });
      doc.text('Email: vazhai.connect@gmail.com | Website: https://vazhai.in | Reg. No. 296/05, Tamil Nadu', 50, footerY + 76, { align: 'center' });
      doc.text('This is a computer-generated receipt and does not require a physical signature.', 50, footerY + 90, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const store = await getStore(event);
    const session = await getSession(store, event);
    if (!session) {
      return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const paymentId = event.queryStringParameters?.paymentId;
    if (!paymentId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing "paymentId" query parameter.' }) };
    }

    // Fetch payment record from store
    const payment = await store.get(`payment:${paymentId}`, { type: 'json' });
    if (!payment) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment record not found.' }) };
    }

    // Determine if the session user is an admin
    const userEmail = session.email.toLowerCase().trim();
    const isAdmin = ADMIN_EMAILS.includes(session.email);

    // Verify the payment belongs to this user (unless admin)
    const paymentEmail = (payment.email || payment.donorEmail || '').toLowerCase().trim();
    if (!isAdmin && paymentEmail && paymentEmail !== userEmail) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'This payment does not belong to your account.' }) };
    }

    // Get user profile for name etc.
    // For admins downloading another donor's receipt, use the donor's info from the payment record.
    // For regular users, use their own profile info.
    let userName, userAddress, userPan, receiptEmail;

    if (isAdmin) {
      // Admin: use donor info from the payment record
      const donorEmail = paymentEmail || userEmail;
      const donorProfile = await getUserProfile(store, donorEmail);
      userName = donorProfile.name || payment.donorName || donorEmail.split('@')[0] || 'Donor';
      userAddress = donorProfile.address || payment.donorAddress || '';
      userPan = donorProfile.pan || payment.donorPan || '';
      receiptEmail = donorEmail;
    } else {
      // Regular user: use their own profile
      const userProfile = await getUserProfile(store, userEmail);
      userName = userProfile.name || session.name || payment.donorName || paymentEmail.split('@')[0] || 'Donor';
      userAddress = userProfile.address || payment.donorAddress || '';
      userPan = userProfile.pan || payment.donorPan || '';
      receiptEmail = userEmail;

      // If user has no name set in profile, they need to update it first
      if (!userProfile.name || userProfile.name.trim() === '') {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: 'Please update your name in your profile before downloading a receipt.',
            needsProfileUpdate: true,
          }),
        };
      }
    }

    // Pre-fetch logo buffer (filesystem or HTTPS fallback)
    const logoBuffer = await fetchLogoBuffer();

    // Generate PDF
    const pdfBuffer = await generateReceiptPDF({
      userName,
      userEmail: receiptEmail,
      userAddress,
      userPan,
      payment,
      logoBuffer,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Vazhai_Receipt_${paymentId}.pdf"`,
        'Content-Length': pdfBuffer.length,
        'Access-Control-Allow-Origin': '*',
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('[/razorpay/receipt-pdf] Error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to generate receipt: ' + err.message }),
    };
  }
};