import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import CursorEffect from '@/components/cursor-effect';
import './globals.css';
import { publicPath } from '@/lib/paths';
const mono = localFont({ src: '../public/fonts/jetbrains-mono.ttf', variable: '--font-mono', display: 'swap', weight: '100 800' });
const sans = localFont({ src: '../public/fonts/space-grotesk.ttf', variable: '--font-sans', display: 'swap', weight: '300 700' });
export const metadata: Metadata = { title: 'Renewal · 我的订阅', description: '数字服务订阅、续费时间与支出，集中管理。', appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Renewal' }, icons: { icon: publicPath('/icon.svg'), apple: publicPath('/icons/icon-192.png') } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#080808', colorScheme: 'dark' };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN" className={`${mono.variable} ${sans.variable}`}><body>{children}<CursorEffect /></body></html>; }
