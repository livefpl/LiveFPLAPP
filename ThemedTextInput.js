// ThemedTextInput.js
import React, { forwardRef } from 'react';
import { TextInput, Platform } from 'react-native';
import { useColors } from './theme';

const ThemedTextInput = forwardRef(
  (
    {
      style,
      placeholderTextColor,
      ...props
    },
    ref
  ) => {
    const C = useColors();

    return (
      <TextInput
        ref={ref}
        {...props}
        // Kill any platform default fills/underlines
        underlineColorAndroid="transparent"
        // Ensure the field itself is transparent — the container owns the bg.
        style={[
          {
            backgroundColor: 'transparent',
            color: C.ink,
            paddingVertical: Platform.select({ ios: 12, android: 10 }),
            includeFontPadding: false, // avoids extra top/bottom space on Android
          },
          style,
        ]}
        placeholderTextColor={placeholderTextColor ?? C.muted}
      />
    );
  }
);

export default ThemedTextInput;
