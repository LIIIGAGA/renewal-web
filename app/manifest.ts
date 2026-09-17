import type { MetadataRoute } from 'next';
import { publicPath } from '@/lib/paths';
export const dynamic = 'force-static';
export default function manifest(): MetadataRoute.Manifest { return { name: 'Renewal · 订阅台账', short_name: 'Renewal', description: '我的数字服务订阅台账', start_url: publicPath('/'), scope: publicPath('/'), display: 'standalone', background_color: '#080808', theme_color: '#080808', lang: 'zh-CN', icons: [{ src: publicPath('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' }, { src: publicPath('/icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }; }
