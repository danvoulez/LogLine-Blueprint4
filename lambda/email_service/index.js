/**
 * Lambda Email Service
 * Sends emails via AWS SES (optional service)
 * 
 * Environment variables:
 *   SES_REGION - AWS SES region (default: us-east-1)
 *   FROM_EMAIL - Sender email (noreply@loglineos.com)
 *   VERIFICATION_TABLE - DynamoDB table for email verifications
 *   VERIFICATION_BASE_URL - Base URL for verification links
 *   AWS_REGION - AWS region
 */

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { randomBytes } = require('crypto');

const ses = new SESClient({ region: process.env.SES_REGION || process.env.AWS_REGION || 'us-east-1' });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

/**
 * Generate verification token
 */
function generateVerificationToken() {
  return `verify_${randomBytes(24).toString('base64url')}`;
}

/**
 * Send verification email
 */
async function sendVerificationEmail(email, token, displayName = '') {
  const verificationUrl = `${process.env.VERIFICATION_BASE_URL || 'https://app.loglineos.com'}/verify?token=${token}`;
  const name = displayName || 'there';
  
  const htmlBody = `
    <html>
      <body>
        <h2>Verify your LogLineOS email</h2>
        <p>Hi ${name},</p>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p>This link will expire in 24 hours.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </body>
    </html>
  `;
  
  const textBody = `
    Verify your LogLineOS email
    
    Hi ${name},
    
    Please verify your email by visiting:
    ${verificationUrl}
    
    This link expires in 24 hours.
  `;
  
  try {
    await ses.send(new SendEmailCommand({
      Source: process.env.FROM_EMAIL,
      Destination: {
        ToAddresses: [email]
      },
      Message: {
        Subject: {
          Data: 'Verify your LogLineOS email',
          Charset: 'UTF-8'
        },
        Body: {
          Html: { Data: htmlBody, Charset: 'UTF-8' },
          Text: { Data: textBody, Charset: 'UTF-8' }
        }
      }
    }));
    
    return { ok: true, messageId: 'sent' };
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}

/**
 * Send recovery email
 */
async function sendRecoveryEmail(email, recoveryToken, displayName = '') {
  const recoveryUrl = `${process.env.VERIFICATION_BASE_URL || 'https://app.loglineos.com'}/recover?token=${recoveryToken}`;
  const name = displayName || 'there';
  
  const htmlBody = `
    <html>
      <body>
        <h2>Recover your LogLineOS account</h2>
        <p>Hi ${name},</p>
        <p>You requested to recover your account. Click the link below:</p>
        <p><a href="${recoveryUrl}">${recoveryUrl}</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email and secure your account.</p>
      </body>
    </html>
  `;
  
  try {
    await ses.send(new SendEmailCommand({
      Source: process.env.FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: 'Recover your LogLineOS account', Charset: 'UTF-8' },
        Body: {
          Html: { Data: htmlBody, Charset: 'UTF-8' }
        }
      }
    }));
    
    return { ok: true };
  } catch (error) {
    console.error('Failed to send recovery email:', error);
    throw error;
  }
}

/**
 * Send security notification
 */
async function sendSecurityNotification(email, eventType, details, displayName = '') {
  const name = displayName || 'there';
  
  const events = {
    'token_issued': {
      subject: 'New API token issued',
      message: `A new API token was issued for your account. If this wasn't you, please revoke it immediately.`
    },
    'token_revoked': {
      subject: 'API token revoked',
      message: `An API token was revoked from your account.`
    },
    'wallet_created': {
      subject: 'Wallet created',
      message: `A new wallet was created for your account.`
    },
    'key_registered': {
      subject: 'New key registered',
      message: `A new key was registered in your wallet.`
    }
  };
  
  const event = events[eventType] || { subject: 'Security notification', message: 'A security event occurred.' };
  
  const htmlBody = `
    <html>
      <body>
        <h2>${event.subject}</h2>
        <p>Hi ${name},</p>
        <p>${event.message}</p>
        ${details ? `<p>Details: ${JSON.stringify(details, null, 2)}</p>` : ''}
        <p>If you didn't perform this action, please secure your account immediately.</p>
      </body>
    </html>
  `;
  
  try {
    await ses.send(new SendEmailCommand({
      Source: process.env.FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: event.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: htmlBody, Charset: 'UTF-8' }
        }
      }
    }));
    
    return { ok: true };
  } catch (error) {
    console.error('Failed to send security notification:', error);
    // Don't throw - notifications are non-critical
    return { ok: false, error: error.message };
  }
}

/**
 * POST /email/verify/send
 * Sends verification email
 */
async function handleVerifySend(event) {
  const { email, display_name } = JSON.parse(event.body || '{}');
  
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email required' }) };
  }
  
  const token = generateVerificationToken();
  const expiresAt = Math.floor(Date.now() / 1000) + (24 * 3600); // 24 hours
  
  // Store token in DynamoDB
  await dynamoClient.send(new PutCommand({
    TableName: process.env.VERIFICATION_TABLE || 'email_verifications',
    Item: {
      email: email,
      token: token,
      type: 'email_verification',
      expires_at: expiresAt,
      status: 'pending',
      created_at: Math.floor(Date.now() / 1000)
    }
  }));
  
  // Send email
  try {
    await sendVerificationEmail(email, token, display_name);
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: 'Verification email sent'
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to send email',
        details: error.message
      })
    };
  }
}

/**
 * POST /email/verify/confirm
 * Confirms verification token
 */
async function handleVerifyConfirm(event) {
  const { token } = JSON.parse(event.body || '{}');
  
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'token required' }) };
  }
  
  // Scan table to find token (in production, use GSI on token)
  const result = await dynamoClient.send(new ScanCommand({
    TableName: process.env.VERIFICATION_TABLE || 'email_verifications',
    FilterExpression: 'token = :token AND #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':token': token,
      ':status': 'pending'
    }
  }));
  
  if (!result.Items || result.Items.length === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Token not found or already used' }) };
  }
  
  const verification = result.Items[0];
  
  // Check expiration
  if (verification.expires_at && verification.expires_at < Math.floor(Date.now() / 1000)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Token expired' }) };
  }
  
  // Mark as verified
  await dynamoClient.send(new UpdateCommand({
    TableName: process.env.VERIFICATION_TABLE || 'email_verifications',
    Key: { email: verification.email },
    UpdateExpression: 'SET #status = :verified, verified_at = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':verified': 'verified',
      ':now': Math.floor(Date.now() / 1000)
    }
  }));
  
  // Create email.verified span (via API or return for client to store)
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      email: verification.email,
      verified_at: new Date().toISOString(),
      email_verified_span: {
        entity_type: 'email.verified',
        who: 'user:self',
        did: 'verified',
        this: 'email.verification',
        metadata: {
          email: verification.email,
          verification_token: token,
          verified_at: new Date().toISOString()
        }
      }
    })
  };
}

/**
 * POST /email/recovery/send
 * Sends recovery email
 */
async function handleRecoverySend(event) {
  const { email, display_name } = JSON.parse(event.body || '{}');
  
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email required' }) };
  }
  
  const token = generateVerificationToken();
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  
  // Store recovery token
  await dynamoClient.send(new PutCommand({
    TableName: process.env.VERIFICATION_TABLE || 'email_verifications',
    Item: {
      email: email,
      token: token,
      type: 'recovery',
      expires_at: expiresAt,
      status: 'pending',
      created_at: Math.floor(Date.now() / 1000)
    }
  }));
  
  // Send email
  try {
    await sendRecoveryEmail(email, token, display_name);
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: 'Recovery email sent'
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to send recovery email',
        details: error.message
      })
    };
  }
}

/**
 * POST /email/notify
 * Sends security notification
 */
async function handleNotify(event) {
  const { email, event_type, details, display_name } = JSON.parse(event.body || '{}');
  
  if (!email || !event_type) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email, event_type required' }) };
  }
  
  try {
    await sendSecurityNotification(email, event_type, details, display_name);
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: 'Notification sent'
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to send notification',
        details: error.message
      })
    };
  }
}

/**
 * Main handler
 */
exports.handler = async (event) => {
  console.log('📧 Email Service Event:', JSON.stringify(event, null, 2));
  
  try {
    const path = event.path || event.requestContext?.path || '';
    const method = event.httpMethod || event.requestContext?.httpMethod || '';
    
    if (method === 'POST') {
      if (path.includes('/email/verify/send')) {
        return await handleVerifySend(event);
      } else if (path.includes('/email/verify/confirm')) {
        return await handleVerifyConfirm(event);
      } else if (path.includes('/email/recovery/send')) {
        return await handleRecoverySend(event);
      } else if (path.includes('/email/notify')) {
        return await handleNotify(event);
      }
    }
    
    return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    
  } catch (error) {
    console.error('❌ Email Service error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

