'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Archive-style guides; native cursors and all control hit targets stay intact. */
export default function CursorEffect() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Native dialogs use the browser's top layer. Move the overlay into the open
    // dialog so the same cursor remains visible while editing, without another listener.
    const chooseHost = () => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
      const target = dialogs.item(dialogs.length - 1) ?? document.body;
      setHost(previous => previous === target ? previous : target);
    };
    chooseHost();
    const observer = new MutationObserver(chooseHost);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = overlay.current;
    if (!node || !host) return;
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let x = 0;
    let y = 0;
    let mode = 'default';
    const hide = () => {
      cancelAnimationFrame(frame); frame = 0;
      node.dataset.active = 'false'; node.dataset.pressed = 'false';
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !pointer.matches || reduced.matches) { hide(); return; }
      x = event.clientX; y = event.clientY;
      const element = event.target instanceof Element ? event.target : null;
      mode = element?.closest('input:not([type="checkbox"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]') ? 'text'
        : element?.closest('button:not(:disabled), a[href], select, input[type="checkbox"], [role="button"]') ? 'interactive' : 'default';
      if (!frame) frame = requestAnimationFrame(() => {
        node.style.setProperty('--cursor-x', `${x}px`);
        node.style.setProperty('--cursor-y', `${y}px`);
        node.dataset.mode = mode; node.dataset.active = 'true'; frame = 0;
      });
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };
    const down = (event: PointerEvent) => { if(event.pointerType === 'mouse' && pointer.matches && !reduced.matches) node.dataset.pressed = 'true'; };
    const up = () => { node.dataset.pressed = 'false'; };
    const visibility = () => { if(document.hidden) hide(); };
    const mediaChange = () => { if(!pointer.matches || reduced.matches) hide(); };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', leave, { passive: true });
    document.addEventListener('pointerdown', down, { passive: true });
    document.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('pointercancel', hide, { passive: true });
    document.addEventListener('keydown', hide);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', hide);
    pointer.addEventListener('change', mediaChange); reduced.addEventListener('change', mediaChange);
    return () => {
      hide(); document.removeEventListener('pointermove', move); document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointerdown', down); document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', hide); document.removeEventListener('keydown', hide);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', hide);
      pointer.removeEventListener('change', mediaChange); reduced.removeEventListener('change', mediaChange);
    };
  }, [host]);

  return host ? createPortal(<div ref={overlay} className="cursor-overlay" aria-hidden="true" data-active="false" data-mode="default" data-pressed="false">
    <span className="cursor-guide cursor-guide-h" />
    <span className="cursor-guide cursor-guide-v" />
    <span className="cursor-target"><span className="cursor-reticle" /></span>
  </div>, host) : null;
}
