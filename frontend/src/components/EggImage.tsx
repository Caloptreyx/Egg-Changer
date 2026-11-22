import { AspectRatio, type MantineSize } from '@mantine/core';
import { type ReactNode, useState } from 'react';
import Box from '@/elements/layout/Box.tsx';

interface EggImageProps {
  /** An https URL the backend validated, or null for no picture. */
  src: string | null;
  /** Width to height; the picture is cropped to fill it, so nothing moves once it loads. */
  ratio: number;
  radius?: MantineSize;
  /** Shown in place of a picture that fails to load. Nothing by default: the layout without a picture. */
  fallback?: ReactNode;
  /** Called when the picture fails to load, e.g. to drop a frame around it. */
  onError?: () => void;
}

/** An egg's icon or banner, only ever as `<img src>`. */
export default function EggImage({ src, ratio, radius, fallback = null, onError }: EggImageProps) {
  const [failed, setFailed] = useState<string | null>(null);

  if (!src) return null;
  if (failed === src) return fallback;

  return (
    <Box
      style={{
        overflow: 'hidden',
        borderRadius: radius ? `var(--mantine-radius-${radius})` : undefined,
        background: 'var(--mantine-color-default-hover)',
      }}
    >
      <AspectRatio ratio={ratio}>
        <img
          src={src}
          alt=''
          loading='lazy'
          decoding='async'
          referrerPolicy='no-referrer'
          draggable={false}
          onError={() => {
            setFailed(src);
            onError?.();
          }}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </AspectRatio>
    </Box>
  );
}
