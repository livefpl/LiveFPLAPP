import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FplIdContext = createContext(null);

export const useFplId = () => useContext(FplIdContext);

export const FplIdProvider = ({ children }) => {
  const [fplId, setFplId] = useState('');
  const [triggerRefetch, setTriggerRefetch] = useState(false);

  // Hydrate context from AsyncStorage on startup
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('fplId');
        if (stored) {
          setFplId(stored);
          setTriggerRefetch(prev => !prev);
        }
      } catch (err) {
        console.warn('Failed to load stored fplId', err);
      }
    })();
  }, []);

  const updateFplId = async (newId) => {
    try {
      await AsyncStorage.setItem('fplId', newId);
    } catch (err) {
      console.warn('Failed to save fplId', err);
    }
    setFplId(newId);
    setTriggerRefetch(prev => !prev);
  };

  return (
    <FplIdContext.Provider value={{ fplId, updateFplId, triggerRefetch }}>
      {children}
    </FplIdContext.Provider>
  );
};
