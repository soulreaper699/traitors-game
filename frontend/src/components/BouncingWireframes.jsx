import { useEffect, useRef } from 'react';
import { Skull, Ghost, ShieldAlert } from 'lucide-react';

export default function BouncingWireframes() {
  const containerRef = useRef(null);
  const itemsRef = useRef([]);

  useEffect(() => {
    let animationFrameId;
    
    // Pixel speed per frame
    const speed = 1.2;
    
    const elements = itemsRef.current;
    if (!elements || elements.length !== 3) return;

    // Use percentage of window to start them nicely spaced
    const objs = [
      { x: window.innerWidth * 0.1, y: window.innerHeight * 0.1, vx: speed, vy: speed, size: 300, el: elements[0] },
      { x: window.innerWidth * 0.6, y: window.innerHeight * 0.2, vx: -speed, vy: speed, size: 400, el: elements[1] },
      { x: window.innerWidth * 0.3, y: window.innerHeight * 0.6, vx: speed, vy: -speed, size: 250, el: elements[2] }
    ];

    const update = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;

      // Move & Wall Collisions
      for (let i = 0; i < objs.length; i++) {
        let o = objs[i];
        o.x += o.vx;
        o.y += o.vy;

        if (o.x < 0) { o.x = 0; o.vx *= -1; }
        if (o.x + o.size > W) { o.x = W - o.size; o.vx *= -1; }
        if (o.y < 0) { o.y = 0; o.vy *= -1; }
        if (o.y + o.size > H) { o.y = H - o.size; o.vy *= -1; }
      }

      // Object Collisions (Circle-based)
      for (let i = 0; i < objs.length; i++) {
        for (let j = i + 1; j < objs.length; j++) {
          let a = objs[i];
          let b = objs[j];
          
          let ax = a.x + a.size / 2;
          let ay = a.y + a.size / 2;
          let bx = b.x + b.size / 2;
          let by = b.y + b.size / 2;

          let dx = bx - ax;
          let dy = by - ay;
          let dist = Math.sqrt(dx * dx + dy * dy);
          
          let minDist = (a.size / 2) + (b.size / 2);

          if (dist < minDist) {
            // Push them apart so they don't stick
            let overlap = minDist - dist;
            let nx = dx / dist;
            let ny = dy / dist;

            a.x -= (nx * overlap) / 2;
            a.y -= (ny * overlap) / 2;
            b.x += (nx * overlap) / 2;
            b.y += (ny * overlap) / 2;

            // Simple velocity swap
            let tempVx = a.vx;
            let tempVy = a.vy;
            a.vx = b.vx;
            a.vy = b.vy;
            b.vx = tempVx;
            b.vy = tempVy;
          }
        }
      }

      // Render
      for (let i = 0; i < objs.length; i++) {
        let o = objs[i];
        if (o.el) {
          o.el.style.transform = `translate(${o.x}px, ${o.y}px)`;
        }
      }

      animationFrameId = requestAnimationFrame(update);
    };

    update();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="wireframes-3d" ref={containerRef}>
      <div ref={el => itemsRef.current[0] = el} className="wireframe w-1-bounce" style={{ width: 300, height: 300, position: 'absolute', top: 0, left: 0 }}>
        <Skull strokeWidth={0.5} className="spin-3d" style={{ width: '100%', height: '100%' }} />
      </div>
      <div ref={el => itemsRef.current[1] = el} className="wireframe w-2-bounce" style={{ width: 400, height: 400, position: 'absolute', top: 0, left: 0 }}>
        <Ghost strokeWidth={0.5} className="spin-3d" style={{ width: '100%', height: '100%' }} />
      </div>
      <div ref={el => itemsRef.current[2] = el} className="wireframe w-3-bounce" style={{ width: 250, height: 250, position: 'absolute', top: 0, left: 0 }}>
        <ShieldAlert strokeWidth={0.5} className="spin-3d" style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}
