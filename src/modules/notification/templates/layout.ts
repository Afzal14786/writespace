/**
 * Responsive Email Layout
 * Compatible with Gmail, Outlook, Apple Mail, and mobile devices.
 * Uses a max-width container of 600px and client-specific resets.
 */
export const emailLayout = (
  content: string,
  title: string = "Writespace Notification",
) => `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${title}</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style>
        table, td, div, h1, p { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
        body { margin: 0; padding: 0; background-color: #f4f6f8; }
        .container { 
            width: 100%; 
            max-width: 600px; 
            margin: 0 auto; 
            background-color: #ffffff; 
            border-radius: 12px; 
            overflow: hidden; 
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 26px;
            font-weight: 700;
            letter-spacing: 0.5px;
        }
        .content {
            padding: 40px 30px;
            color: #4a5568;
            font-size: 16px;
            line-height: 1.6;
        }
        .btn {
            display: inline-block;
            padding: 14px 30px;
            margin-top: 20px;
            margin-bottom: 20px;
            background-color: #764ba2;
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            box-shadow: 0 4px 6px rgba(118, 75, 162, 0.2);
            transition: transform 0.2s;
        }
        .btn:hover {
            background-color: #5b3a7d;
        }
        .footer {
            background-color: #f8fafc;
            padding: 24px;
            text-align: center;
            border-top: 1px solid #edf2f7;
        }
        .footer p {
            margin: 5px 0;
            color: #a0aec0;
            font-size: 13px;
        }
        .link {
            color: #764ba2;
            text-decoration: none;
        }
        
        /* Mobile Responsive */
        @media only screen and (max-width:480px) {
            .content { padding: 25px 20px; }
            .header { padding: 25px; }
        }
    </style>
</head>
<body style="margin:0;padding:0;">
    <div style="padding: 20px 0;">
        <div class="container">
            <!-- Header -->
            <div class="header">
                <h1>Blogify</h1>
            </div>
            
            <!-- Main Content -->
            <div class="content">
                ${content}
            </div>

            <!-- Footer -->
            <div class="footer">
        <p>&copy; ${new Date().getFullYear()} Writespace. All rights reserved.</p>
        <p>
          <a href="${process.env.CLIENT_URL}/privacy">Privacy Policy</a> | 
          <a href="${process.env.CLIENT_URL}/terms">Terms of Service</a>
        </p>
      </div>
        </div>
    </div>
</body>
</html>
`;
