// Netlify Function: GET /razorpay/receipt-pdf?paymentId=pay_xxxxxx
// Authenticated user: Generates and downloads a PDF receipt for a payment
const PDFDocument = require('pdfkit');
const path = require('path');
const { getStore } = require('./auth-store');

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
 * Format a number as Indian currency string (₹)
 */
function formatINR(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
 * Generate the PDF receipt as a Buffer.
 * Uses a clean NGO-style receipt template with Vazhai branding.
 */
function generateReceiptPDF({ userName, userEmail, userAddress, userPan, payment }) {
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
      const logoPath = __dirname + '/../../images/vazahi-logo.jpg';
      try {
        doc.image(logoPath, 50, 28, { width: 60 });
      } catch (_) {
        // Logo file not found, just skip it
      }

      doc.fontSize(22).font('Helvetica-Bold').fillColor(greenDark)
        .text('VAZHAI', 120, 38);
      doc.fontSize(10).font('Helvetica').fillColor('#666')
        .text('NGO Reg. No. 296/05, Tamil Nadu', 120, 63);
      doc.fontSize(9).font('Helvetica').fillColor('#888')
        .text('# 341/157, T.H. Road, Kaladipet, Thiruvottiyur, Chennai – 600 019', 120, 79);

      // ── Receipt Title ──
      doc.moveTo(50, 108).lineTo(545, 108).strokeColor(borderGray).lineWidth(1).stroke();

      doc.fontSize(18).font('Helvetica-Bold').fillColor(greenDark)
        .text('DONATION RECEIPT', 50, 123, { align: 'center' });

      // ── Receipt Number & Date line ──
      doc.moveTo(50, 152).lineTo(545, 152).strokeColor(borderGray).lineWidth(1).stroke();

      const receiptId = payment.paymentId || '—';
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

      // Helper for donor info lines — using per-character font switching for mixed English/Tamil
      function donorLabel(label, x, y) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor(textColor).text(label, x, y);
      }

      // donorValue handles mixed English+Tamil text using whole-string font selection
      // If text contains any Unicode characters, render entire string with NotoSansTamil
      // (which supports Latin characters too), otherwise use Helvetica.
      function donorValue(text, x, y, opts) {
        if (!text || text === '—') {
          doc.fontSize(10).font('Helvetica').fillColor('#555').text('—', x, y, opts || {});
          return;
        }
        doc.fontSize(10).fillColor('#555');
        if (hasUnicodeFont && hasUnicode(text)) {
          doc.font('NotoSansTamil');
        } else {
          doc.font('Helvetica');
        }
        doc.text(text, x, y, opts || {});
      }

      const donorY = 224;
      donorLabel('Name:', 55, donorY);
      // For name, we also want per-character switching
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

    // Verify the payment belongs to this user
    const userEmail = session.email.toLowerCase().trim();
    const paymentEmail = (payment.email || payment.donorEmail || '').toLowerCase().trim();
    if (paymentEmail && paymentEmail !== userEmail) {
      return { statusCode: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'This payment does not belong to your account.' }) };
    }

    // Get user profile for name etc.
    const userProfile = await getUserProfile(store, userEmail);
    const userName = userProfile.name || session.name || payment.donorName || paymentEmail.split('@')[0] || 'Donor';
    const userAddress = userProfile.address || payment.donorAddress || '';
    const userPan = userProfile.pan || payment.donorPan || '';

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

    // Generate PDF
    const pdfBuffer = await generateReceiptPDF({
      userName,
      userEmail: userEmail,
      userAddress,
      userPan,
      payment,
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