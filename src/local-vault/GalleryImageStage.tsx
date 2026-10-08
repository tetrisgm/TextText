import { useEffect, useRef, useState } from "react";
import "./gallery-image-stage.css";

type Point = { x: number; y: number };
/** Image bytes remain owned by the lightbox; this component only controls its viewport. */
export function GalleryImageStage({ src, alt }: { src: string; alt: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; origin: Point; pan: Point } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(size.width / imageSize.width, size.height / imageSize.height);
  const width = imageSize.width * scale * zoom, height = imageSize.height * scale * zoom;
  const clamp = (point: Point): Point => ({ x: Math.max(-Math.max(0, (width - size.width) / 2), Math.min(Math.max(0, (width - size.width) / 2), point.x)), y: Math.max(-Math.max(0, (height - size.height) / 2), Math.min(Math.max(0, (height - size.height) / 2), point.y)) });
  const position = clamp(pan);
  const fit = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  return <div className="vault-gallery-stage vault-gallery-image-stage">
    <div ref={viewport} className="vault-gallery-image-viewport" tabIndex={0} role="group" aria-label="Image viewer" aria-describedby="gallery-pan-help" data-zoomed={zoom > 1} data-dragging={dragging}
      onKeyDown={event => {
        const delta = ({ ArrowLeft: { x: 50, y: 0 }, ArrowRight: { x: -50, y: 0 }, ArrowUp: { x: 0, y: 50 }, ArrowDown: { x: 0, y: -50 } } as Record<string, Point>)[event.key];
        if (delta && zoom > 1) { event.preventDefault(); event.stopPropagation(); setPan(clamp({ x: position.x + delta.x, y: position.y + delta.y })); }
        else if (event.key === "0") { event.preventDefault(); fit(); }
      }}
      onPointerDown={event => {
        if (zoom <= 1 || event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, origin: { x: event.clientX, y: event.clientY }, pan: position }; setDragging(true);
      }}
      onPointerMove={event => { const active = drag.current; if (active?.pointer === event.pointerId) setPan(clamp({ x: active.pan.x + event.clientX - active.origin.x, y: active.pan.y + event.clientY - active.origin.y })); }}
      onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { drag.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} draggable={false} onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })} style={{ width, height, transform: `translate(${position.x}px, ${position.y}px)` }} />
    </div>
    <span id="gallery-pan-help" className="ac-sr-only">When zoomed, drag the image or use arrow keys to pan. Press 0 to fit.</span>
    <div className="vault-gallery-zoom" role="group" aria-label="Image zoom"><button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .25))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))}>+</button><button aria-label="Fit image" disabled={zoom === 1} onClick={fit}>Fit</button></div>
  </div>;
}
