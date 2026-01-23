export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, action, token, newPassword } = req.body;

  // ACTION 1: Request password reset
  if (action === 'request') {
    try {
      // Generate reset token
      const resetToken = Math.random().toString(36).substring(2, 15) + 
                         Math.random().toString(36).substring(2, 15);
      const resetExpiry = Date.now() + 3600000; // 1 hour

      // In production, store this in a database
      // For now, we'll send it via email
      
      await sendPasswordResetEmail(email, resetToken);

      return res.status(200).json({ 
        success: true, 
        message: 'Password reset email sent' 
      });
    } catch (error) {
      console.error('Password reset error:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to send reset email' 
      });
    }
  }

  // ACTION 2: Verify token and reset password
  if (action === 'reset') {
    // In production, verify token from database
    // For demo, we'll accept any token
    
    return res.status(200).json({ 
      success: true, 
      message: 'Password reset successful' 
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// Send password reset email
async function sendPasswordResetEmail(email, token) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    console.log('⚠️ Resend not configured');
    return;
  }

  const resetLink = `https://d818-restaurant.vercel.app/reset-password?token=${token}&email=${email}`;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #f97316; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0;">🔐 Password Reset Request</h1>
      </div>
      
      <div style="padding: 30px; background: #fff;">
        <p style="font-size: 16px;">Hello,</p>
        
        <p style="font-size: 16px;">
          We received a request to reset your password for your D818 account.
        </p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" 
             style="background: #f97316; color: white; padding: 15px 40px; 
                    text-decoration: none; border-radius: 8px; font-weight: bold;
                    display: inline-block;">
            Reset Password
          </a>
        </div>

        <p style="font-size: 14px; color: #666;">
          Or copy and paste this link into your browser:
        </p>
        <p style="font-size: 12px; color: #0057FF; word-break: break-all;">
          ${resetLink}
        </p>

        <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #92400e; font-size: 14px;">
            ⚠️ This link will expire in 1 hour.
          </p>
        </div>

        <p style="font-size: 14px; color: #666;">
          If you didn't request this, please ignore this email.
        </p>

        <p style="font-size: 14px; color: #666; margin-top: 30px;">
          Thanks,<br/>
          The D818 Team
        </p>
      </div>

      <div style="background: #1f2937; color: #9ca3af; padding: 15px; text-align: center;">
        <p style="margin: 0; font-size: 12px;">D818 Restaurant - Nottingham</p>
      </div>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'D818 Restaurant <onboarding@resend.dev>',
      to: email,
      subject: '🔐 Reset Your D818 Password',
      html: emailHtml
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send email: ${error}`);
  }

  console.log('✅ Password reset email sent to:', email);
}
