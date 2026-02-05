import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Updates from 'expo-updates';

export default function UpdatesDebugPanel() {
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setInfo({
      channel: Updates.channel ?? '—',
      runtimeVersion: Updates.runtimeVersion ?? '—',
      updateId: Updates.updateId ?? '—',
      createdAt: Updates.createdAt
        ? new Date(Updates.createdAt).toISOString()
        : '—',
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      isEmergencyLaunch: Updates.isEmergencyLaunch,
      isEnabled: Updates.isEnabled,
      updateUrl: Updates.updateUrl ?? '—',
    });
  }, []);

  const checkAndApply = useCallback(async () => {
    try {
      setStatus('Checking for update…');
      const res = await Updates.checkForUpdateAsync();

      if (!res.isAvailable) {
        setStatus('No update available for this build.');
        return;
      }

      setStatus('Update available. Downloading…');
      await Updates.fetchUpdateAsync();

      setStatus('Downloaded. Reloading…');
      await Updates.reloadAsync();
    } catch (e) {
      setStatus(`Error: ${e?.message || String(e)}`);
    }
  }, []);

  if (!info) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Updates Debug</Text>

      <Row label="Channel" value={info.channel} />
      <Row label="Runtime" value={info.runtimeVersion} />
      <Row label="Update ID" value={info.updateId} />
      <Row label="Created At" value={info.createdAt} />
      <Row label="Embedded Launch" value={String(info.isEmbeddedLaunch)} />
      <Row label="Emergency Launch" value={String(info.isEmergencyLaunch)} />
      <Row label="Updates Enabled" value={String(info.isEnabled)} />
      <Row label="Update URL" value={info.updateUrl} />

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <TouchableOpacity
        style={styles.reload}
        onPress={checkAndApply}
      >
        <Text style={styles.reloadText}>Check & Apply Update</Text>
      </TouchableOpacity>
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f3f5f9',
    marginTop: 12,
  },
  title: {
    fontWeight: '800',
    marginBottom: 8,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontWeight: '600',
    color: '#444',
    width: 140,
  },
  value: {
    flex: 1,
    textAlign: 'right',
    color: '#000',
    fontFamily: 'monospace',
  },
  status: {
    marginTop: 8,
    fontSize: 12,
    color: '#333',
  },
  reload: {
    marginTop: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1e88e5',
  },
  reloadText: {
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
  },
});
