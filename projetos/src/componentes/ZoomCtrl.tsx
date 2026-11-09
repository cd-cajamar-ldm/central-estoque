import { useEffect, useState } from 'react';

const MIN = 70, MAX = 150, STEP = 10;
const CHAVE = 'projetos-zoom';

export default function ZoomCtrl() {
  const [zoom, setZoom] = useState(() => {
    try { return Number(localStorage.getItem(CHAVE)) || 100; } catch { return 100; }
  });

  useEffect(() => {
    document.body.style.zoom = String(zoom / 100);
    try { localStorage.setItem(CHAVE, String(zoom)); } catch { /* só não lembra */ }
  }, [zoom]);

  function mudar(delta: number) {
    setZoom((z) => Math.max(MIN, Math.min(MAX, z + delta)));
  }

  return (
    <div className="zoom-ctrl zoom-ctrl-float" title="Zoom da tela">
      <button type="button" onClick={() => mudar(-STEP)} aria-label="Diminuir zoom">−</button>
      <span>{zoom}%</span>
      <button type="button" onClick={() => mudar(STEP)} aria-label="Aumentar zoom">+</button>
    </div>
  );
}
