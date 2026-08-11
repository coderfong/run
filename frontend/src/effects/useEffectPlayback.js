import { useCallback, useEffect, useRef, useState } from 'react';

// A small replay/lifecycle primitive shared by gallery previews and callers
// that want an imperative replay button without knowing the underlying format.
export default function useEffectPlayback({ autoPlay = true, onComplete } = {}) {
  const [playToken, setPlayToken] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const replay = useCallback(() => {
    setPlaying(true);
    setPlayToken((token) => token + 1);
  }, []);

  const complete = useCallback(() => {
    if (!mounted.current) return;
    setPlaying(false);
    onComplete?.();
  }, [onComplete]);

  return { playToken, playing, replay, complete, setPlaying };
}
