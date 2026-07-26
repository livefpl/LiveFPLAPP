import React, { createContext, useContext } from 'react';

const PreseasonContext = createContext({ preseason: false });

export function PreseasonProvider({ preseason = false, children }) {
  return (
    <PreseasonContext.Provider value={{ preseason: !!preseason }}>
      {children}
    </PreseasonContext.Provider>
  );
}

export function usePreseason() {
  return useContext(PreseasonContext);
}

export function isPreseasonFlag(raw) {
  return raw === 1 || raw === '1' || raw === true || raw === 'true';
}
