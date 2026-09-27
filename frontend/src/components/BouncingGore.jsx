import { useEffect, useRef, useState } from 'react';
import { Skull, ShieldAlert, Crosshair, Droplets } from 'lucide-react';

const ICONS = [Skull, ShieldAlert, Crosshair, Droplets];
const ITEM_COUNT = 8;

export default function BouncingGore() {
  const containerRef = useRef(null);
  const itemsRef = useRef([]);
  const [dimensions, setDimensions] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Initialize random positions and velocities
  useEffect(() => {
    const handleResize = () => setDimensions({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handleResize);
    
    itemsRef.current = Array.from({ length: ITEM_COUNT }).map(() => ({
      x: Math.random() * (window.innerWidth - 100),
      y: Math.random() * (window.innerHeight - 100),
      vx: (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 2 + 1), // Continuous diagonal speed
      vy: (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 2 + 1),
      size: Math.random() * 100 + 50, // 50 to 150px
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 2,
      Icon: ICONS[Math.floor(Math.random() * ICONS.length)]
    }));

    let animationId;

    const animate = () => {
      if (!containerRef.current) return;
      
      const elements = containerRef.current.children;
      const w = window.innerWidth;
      const h = window.innerHeight;

      itemsRef.current.forEach((item, i) => {
        // Move
        item.x += item.vx;
        item.y += item.vy;
        item.rotation += item.rotSpeed;

        // Bounce off walls (collide)
        if (item.x <= 0 || item.x + item.size >= w) {
          item.vx *= -1;
          item.x = item.x <= 0 ? 0 : w - item.size;
        }
        if (item.y <= 0 || item.y + item.size >= h) {
          item.vy *= -1;
          item.y = item.y <= 0 ? 0 : h - item.size;
        }

        // Apply physics to DOM elements
        if (elements[i]) {
          elements[i].style.transform = `translate3d(${item.x}px, ${item.y}px, 0) rotate(${item.rotation}deg)`;
        }
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {itemsRef.current.map((item, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: 0, left: 0,
          width: item.size, height: item.size,
          color: 'rgba(220, 20, 60, 0.4)', // HIGH VISIBILITY GORE RED
          filter: 'drop-shadow(0 0 20px rgba(220, 20, 60, 0.8)) blur(1px)', // GLOW
          willChange: 'transform'
        }}>
          <item.Icon style={{ width: '100%', height: '100%' }} />
        </div>
      ))}
    </div>
  );
}
