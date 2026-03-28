export const baseEmailLayout = (content: string, title: string): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { 
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background-color: #f8fafc; 
      margin: 0; 
      padding: 0; 
      color: #0f172a; 
    }
    .container { 
      max-width: 600px; 
      margin: 40px auto; 
      background: #ffffff; 
      border-radius: 12px; 
      overflow: hidden; 
      box-shadow: 0 4px 6px rgba(0,0,0,0.05); 
      border: 1px solid #e2e8f0; 
    }
    .header { 
      background-color: #6366f1; /* Frontend Primary Accent Color */
      padding: 24px; 
      text-align: center; 
    }
    .header h1 { 
      margin: 0; 
      color: #ffffff; 
      font-size: 24px; 
      font-weight: 800; 
      letter-spacing: -0.5px; 
    }
    .content { 
      padding: 32px 24px; 
      font-size: 16px; 
      line-height: 1.6; 
      color: #334155; 
    }
    .button { 
      display: inline-block; 
      background-color: #6366f1; 
      color: #ffffff; 
      text-decoration: none; 
      padding: 12px 24px; 
      border-radius: 8px; 
      font-weight: 600; 
      margin-top: 16px; 
    }
    .footer { 
      background-color: #f8fafc; 
      padding: 20px; 
      text-align: center; 
      font-size: 14px; 
      color: #64748b; 
      border-top: 1px solid #e2e8f0; 
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Writespace</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} Writespace. All rights reserved.</p>
      <p style="margin-top: 8px; font-size: 12px;">This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
`;