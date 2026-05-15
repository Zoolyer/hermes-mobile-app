import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type Role = 'user' | 'assistant';

type Message = {
  id: string;
  role: Role;
  content: string;
};

const DEFAULT_API_BASE = 'http://192.168.1.10:8123';
const STORAGE_API_BASE_KEY = 'hermes.apiBase';
const STORAGE_MESSAGES_KEY = 'hermes.messages';

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  const canSend = useMemo(
    () => !loading && input.trim().length > 0 && apiBase.trim().length > 0,
    [input, loading, apiBase]
  );

  useEffect(() => {
    (async () => {
      try {
        const [storedBase, storedMessages] = await Promise.all([
          AsyncStorage.getItem(STORAGE_API_BASE_KEY),
          AsyncStorage.getItem(STORAGE_MESSAGES_KEY),
        ]);

        if (storedBase?.trim()) {
          setApiBase(storedBase);
        }

        if (storedMessages) {
          const parsed = JSON.parse(storedMessages) as Message[];
          if (Array.isArray(parsed)) {
            setMessages(parsed);
          }
        }
      } catch {
        // ignore local storage restore errors
      } finally {
        setBootstrapped(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!bootstrapped) return;
    AsyncStorage.setItem(STORAGE_API_BASE_KEY, apiBase).catch(() => undefined);
  }, [apiBase, bootstrapped]);

  useEffect(() => {
    if (!bootstrapped) return;
    AsyncStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(messages)).catch(
      () => undefined
    );
  }, [messages, bootstrapped]);

  async function onSend() {
    const text = input.trim();
    if (!text) return;

    setError(null);
    const userMsg: Message = {
      id: `${Date.now()}-u`,
      role: 'user',
      content: text,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const resp = await fetch(`${apiBase.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = (await resp.json()) as {
        reply?: string;
        content?: string;
      };

      const assistantText = data.reply ?? data.content ?? '（服务返回空内容）';

      const assistantMsg: Message = {
        id: `${Date.now()}-a`,
        role: 'assistant',
        content: assistantText,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function onClearChat() {
    setMessages([]);
    setError(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>Hermes Mobile Chat</Text>
          <Pressable style={styles.clearBtn} onPress={onClearChat}>
            <Text style={styles.clearBtnText}>清空</Text>
          </Pressable>
        </View>

        <View style={styles.baseRow}>
          <Text style={styles.label}>API Base</Text>
          <TextInput
            value={apiBase}
            onChangeText={setApiBase}
            style={styles.baseInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://host:port"
          />
        </View>

        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={[
                styles.msg,
                item.role === 'user' ? styles.userMsg : styles.assistantMsg,
              ]}
            >
              <Text style={styles.msgRole}>{item.role === 'user' ? '你' : 'Hermes'}</Text>
              <Text style={styles.msgText}>{item.content}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>发送第一条消息开始对话</Text>
          }
        />

        {error ? <Text style={styles.error}>请求失败：{error}</Text> : null}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="输入消息..."
            value={input}
            onChangeText={setInput}
            multiline
          />
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            style={[styles.btn, !canSend && styles.btnDisabled]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>发送</Text>
            )}
          </Pressable>
        </View>

        <StatusBar style="dark" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f7fb' },
  container: { flex: 1, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#121826' },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#e7ecf4',
  },
  clearBtnText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  baseRow: { marginBottom: 8 },
  label: { fontSize: 12, color: '#5b6472', marginBottom: 4 },
  baseInput: {
    borderWidth: 1,
    borderColor: '#d7deea',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  list: { flex: 1, marginTop: 4 },
  listContent: { gap: 8, paddingVertical: 6 },
  empty: { textAlign: 'center', marginTop: 30, color: '#8d95a3' },
  msg: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: '92%',
  },
  userMsg: {
    alignSelf: 'flex-end',
    backgroundColor: '#1f6feb',
  },
  assistantMsg: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3e8f1',
  },
  msgRole: {
    fontSize: 11,
    marginBottom: 2,
    color: '#6a7383',
  },
  msgText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#111827',
  },
  error: {
    color: '#c81e1e',
    fontSize: 12,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 6,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#d7deea',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  btn: {
    height: 42,
    minWidth: 64,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
