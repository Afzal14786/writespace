import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { html } from 'satori-html';

let fontCache: ArrayBuffer | null = null;

export async function generateProfileOgImage(userData: {
  username: string;
  fullname: string;
  headline?: string | null;
  avatar?: string | null;
}): Promise<Buffer> {
  
  // 1. Fetch the Inter font from Google's stable raw repository
  if (!fontCache) {
    const fontUrl = 'https://cdn.jsdelivr.net/gh/rsms/inter@3.19/docs/font-files/Inter-SemiBold.otf';
    const fontRes = await fetch(fontUrl);
    
    if (!fontRes.ok) {
      throw new Error(`Failed to download font: ${fontRes.status} ${fontRes.statusText}`);
    }
    
    fontCache = await fontRes.arrayBuffer();
  }

  // 2. Fallbacks
  let avatarUrl = userData.avatar || `https://ui-avatars.com/api/?name=${userData.username}&size=256&background=1e293b&color=fff`;

  // 🔥 FIX: Satori crashes on complex SVGs. We force DiceBear URLs to return PNGs instead!
  if (avatarUrl.includes('api.dicebear.com')) {
    avatarUrl = avatarUrl.replace('/svg', '/png');
  }
  const headlineText = userData.headline || 'Software Developer & Tech Enthusiast';

  // 3. The HTML/CSS Layout
  const markup = html`
    <div style="display: flex; flex-direction: column; justify-content: space-between; width: 1200px; height: 630px; background-color: #0f172a; padding: 80px; font-family: 'Inter'; color: white;">
        
        <div style="position: absolute; top: -150px; right: -150px; width: 600px; height: 600px; background-color: rgba(99, 102, 241, 0.2); border-radius: 50%; filter: blur(100px); display: flex;"></div>

        <div style="display: flex; align-items: center; margin-bottom: 40px;">
            <img src="${avatarUrl}" width="200" height="200" style="width: 200px; height: 200px; border-radius: 50%; border: 8px solid #6366f1; object-fit: cover;" />
            <div style="display: flex; flex-direction: column; margin-left: 50px;">
                <h1 style="font-size: 80px; font-weight: bold; margin: 0; padding: 0; color: #f8fafc;">${userData.fullname}</h1>
                <p style="font-size: 48px; color: #818cf8; margin: 15px 0 0 0; padding: 0;">@${userData.username}</p>
            </div>
        </div>

        <div style="display: flex; flex-direction: column; max-width: 950px;">
            <p style="font-size: 42px; line-height: 1.4; color: #cbd5e1; margin: 0;">
                ${headlineText}
            </p>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #334155; padding-top: 40px; margin-top: 40px;">
            <div style="display: flex; align-items: center;">
                <div style="font-size: 36px; font-weight: bold; color: white;">Writespace</div>
                <div style="font-size: 36px; color: #64748b; margin-left: 15px;">| Where Ideas Flow</div>
            </div>
        </div>
    </div>
  `;

  // 4. Convert HTML to SVG using Satori
  const svg = await satori(markup, {
    width: 1200,
    height: 630,
    fonts: [{
      name: 'Inter',
      data: fontCache,
      weight: 600,
      style: 'normal',
    }],
  });

  // 5. Convert SVG to high-quality PNG using Resvg
  const resvg = new Resvg(svg, {
    background: '#0f172a',
    fitTo: { mode: 'width', value: 1200 }
  });
  
  const pngData = resvg.render();
  return pngData.asPng();
}