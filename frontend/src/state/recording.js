// Global "is a run being recorded" flag. The Record modal owns the screen
// during a run, but this state lets the tab bar show a live badge and lets
// the modal's close button confirm before discarding an in-progress run.

import React, { createContext, useContext, useMemo, useState } from 'react';

const RecordingContext = createContext({ isRecording: false, setRecording: () => {} });

export function RecordingProvider({ children }) {
  const [isRecording, setRecording] = useState(false);
  const value = useMemo(() => ({ isRecording, setRecording }), [isRecording]);
  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>;
}

export function useRecording() {
  return useContext(RecordingContext);
}
