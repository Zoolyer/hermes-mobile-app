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

type HermesChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  reply?: string;
  content?: string;
  output_text?: string;
};

type HermesCapabilitiesResponse = {
  features?: {
    chat_completions?: boolean;
    models?: boolean;
    [key: string]: unknown;
  };
  endpoints?: {
    chat_completions?: { path?: string };
    models?: { path?: string };
    capabilities?: { path?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type HermesModelsResponse = {
  data?: Array<{ id?: unknown; name?: unknown }>;
  models?: Array<{ id?: unknown; name?: unknown }>;
  [key: string]: unknown;
};

const DEFAULT_API_BASE = 'http://127.0.0.1:8642/v1';
const DEFAULT_MODEL = 'hermes-agent';
const DEFAULT_ANDROID_EMULATOR_BASE = 'http://10.0.2.2:8642/v1';
const DEFAULT_LAN_BASE = 'http://172.31.131.117:8642/v1';
const STORAGE_API_BASE_KEY = 'hermes.apiBase';
const STORAGE_API_KEY = 'hermes.apiKey';
const STORAGE_MODEL_KEY = 'hermes.model';
const STORAGE_MESSAGES_KEY = 'hermes.messages';

function normalizeBase(base: string) {
  return base.trim().replace(/\/+$/, '');
}

function buildApiUrl(base: string, path: string) {
  const cleaned = normalizeBase(base);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return cleaned.endsWith('/v1') ? `${cleaned}${normalizedPath}` : `${cleaned}/v1${normalizedPath}`;
}

function buildChatCompletionsUrl(base: string) {
  return buildApiUrl(base, '/chat/completions');
}

function extractAssistantText(data: HermesChatResponse) {
  const choiceText = data.choices?.[0]?.message?.content;
  if (typeof choiceText === 'string' && choiceText.trim()) return choiceText;
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  if (typeof data.reply === 'string' && data.reply.trim()) return data.reply;
  if (typeof data.content === 'string' && data.content.trim()) return data.content;
  return '（服务返回空内容）';
}

function normalizeAuthHeader(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

async function readHttpErrorDetail(resp: Response) {
  try {
    const body = (await resp.json()) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const errorMessage = body.error?.message;
    if (typeof errorMessage === 'string' && errorMessage.trim()) {
      return `: ${errorMessage}`;
    }
    if (typeof body.message === 'string' && body.message.trim()) {
      return `: ${body.message}`;
    }
  } catch {
    // ignore parse errors
  }
  return '';
}

function formatHttpFailure(endpointName: string, status: number, detail: string) {
  if (status === 404) {
    return `${endpointName} 404${detail}，请确认 Hermes API Base 与路由是否正确`;
  }
  if (status === 401 || status === 403) {
    return `${endpointName} ${status}${detail}，请检查 API Key / 鉴权`;
  }
  return `${endpointName} HTTP ${status}${detail}`;
}

function extractModelIds(data: HermesModelsResponse) {
  const source = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  const ids = source.reduce<string[]>((acc, item) => {
    if (typeof item.id === 'string' && item.id.trim()) acc.push(item.id.trim());
    if (typeof item.name === 'string' && item.name.trim()) acc.push(item.name.trim());
    return acc;
  }, []);
  return Array.from(new Set(ids));
}

function supportLabel(value: boolean | undefined) {
  if (value === true) return '支持';
  if (value === false) return '不支持';
  return '未知';
}

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeCheckedAt, setProbeCheckedAt] = useState<string | null>(null);
  const [probeCapabilities, setProbeCapabilities] = useState<HermesCapabilitiesResponse | null>(null);
  const [probeModels, setProbeModels] = useState<string[]>([]);

  const endpoint = useMemo(() => buildChatCompletionsUrl(apiBase), [apiBase]);
  const capabilitiesEndpoint = useMemo(() => buildApiUrl(apiBase, '/capabilities'), [apiBase]);
  const modelsEndpoint = useMemo(() => buildApiUrl(apiBase, '/models'), [apiBase]);
  const apiBaseReady = useMemo(() => normalizeBase(apiBase).length > 0, [apiBase]);

  const canSend = useMemo(
    () => bootstrapped && !loading && input.trim().length > 0 && apiBaseReady,
    [bootstrapped, input, loading, apiBaseReady]
  );

  async function onProbeApi() {
    if (!apiBaseReady || probeLoading) return;

    setProbeError(null);
    setProbeLoading(true);

    const headers: Record<string, string> = {};
    const authHeader = normalizeAuthHeader(apiKey);
    if (authHeader) headers.Authorization = authHeader;

    const errors: string[] = [];

    try {
      const resp = await fetch(capabilitiesEndpoint, {
        method: 'GET',
        headers,
      });
      if (!resp.ok) {
        errors.push(formatHttpFailure('/v1/capabilities', resp.status, await readHttpErrorDetail(resp)));
      } else {
        const data = (await resp.json()) as HermesCapabilitiesResponse;
        setProbeCapabilities(data);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`/v1/capabilities ${msg}`);
    }

    try {
      const resp = await fetch(modelsEndpoint, {
        method: 'GET',
        headers,
      });
      if (!resp.ok) {
        errors.push(formatHttpFailure('/v1/models', resp.status, await readHttpErrorDetail(resp)));
      } else {
        const data = (await resp.json()) as HermesModelsResponse;
        setProbeModels(extractModelIds(data));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`/v1/models ${msg}`);
    }

    setProbeCheckedAt(new Date().toLocaleString());
    setProbeError(errors.length > 0 ? errors.join(' ｜ ') : null);
    setProbeLoading(false);
  }

  useEffect(() => {
    (async () => {
      try {
        const [storedBase, storedKey, storedModel, storedMessages] = await Promise.all([
          AsyncStorage.getItem(STORAGE_API_BASE_KEY),
          AsyncStorage.getItem(STORAGE_API_KEY),
          AsyncStorage.getItem(STORAGE_MODEL_KEY),
          AsyncStorage.getItem(STORAGE_MESSAGES_KEY),
        ]);

        if (storedBase?.trim()) setApiBase(storedBase);
        if (storedKey !== null) setApiKey(storedKey);
        if (storedModel?.trim()) setModel(storedModel);

        if (storedMessages) {
          const parsed = JSON.parse(storedMessages) as Message[];
          if (Array.isArray(parsed)) setMessages(parsed);
        }
      } catch {
        // ignore local restore errors
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
    AsyncStorage.setItem(STORAGE_API_KEY, apiKey).catch(() => undefined);
  }, [apiKey, bootstrapped]);

  useEffect(() => {
    if (!bootstrapped) return;
    AsyncStorage.setItem(STORAGE_MODEL_KEY, model).catch(() => undefined);
  }, [model, bootstrapped]);

  useEffect(() => {
    if (!bootstrapped) return;
    AsyncStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(messages)).catch(() => undefined);
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const authHeader = normalizeAuthHeader(apiKey);
      if (authHeader) headers.Authorization = authHeader;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model.trim() || DEFAULT_MODEL,
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
        }),
      });

      if (!resp.ok) {
        throw new Error(formatHttpFailure('/v1/chat/completions', resp.status, await readHttpErrorDetail(resp)));
      }

      const data = (await resp.json()) as HermesChatResponse;
      const assistantMsg: Message = {
        id: `${Date.now()}-a`,
        role: 'assistant',
        content: extractAssistantText(data),
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
          <Text style={styles.title}>Hermes Native Chat</Text>
          <Pressable style={styles.clearBtn} onPress={onClearChat}>
            <Text style={styles.clearBtnText}>清空</Text>
          </Pressable>
        </View>

        <View style={styles.baseRow}>
          <Text style={styles.label}>Hermes API Base（含 /v1）</Text>
          <TextInput
            value={apiBase}
            onChangeText={setApiBase}
            style={styles.baseInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://host:8642/v1"
          />
          <View style={styles.quickBaseRow}>
            <Pressable style={styles.quickBaseBtn} onPress={() => setApiBase(DEFAULT_API_BASE)}>
              <Text style={styles.quickBaseBtnText}>本机127.0.0.1</Text>
            </Pressable>
            <Pressable
              style={styles.quickBaseBtn}
              onPress={() => setApiBase(DEFAULT_ANDROID_EMULATOR_BASE)}
            >
              <Text style={styles.quickBaseBtnText}>安卓模拟器10.0.2.2</Text>
            </Pressable>
            <Pressable style={styles.quickBaseBtn} onPress={() => setApiBase(DEFAULT_LAN_BASE)}>
              <Text style={styles.quickBaseBtnText}>同网段LAN</Text>
            </Pressable>
          </View>
          <Text style={styles.baseHint}>
            真机不能用 127.0.0.1；请改为 Hermes 所在机器的局域网 IP（例如 {DEFAULT_LAN_BASE}）。
          </Text>
        </View>

        <View style={styles.baseRow}>
          <Text style={styles.label}>API Key（可选）</Text>
          <TextInput
            value={apiKey}
            onChangeText={setApiKey}
            style={styles.baseInput}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="sk-..."
          />
        </View>

        <View style={styles.baseRow}>
          <Text style={styles.label}>Model</Text>
          <TextInput
            value={model}
            onChangeText={setModel}
            style={styles.baseInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="hermes-agent"
          />
        </View>

        <Text style={styles.endpoint}>Endpoint: {endpoint}</Text>

        <View style={styles.probeCard}>
          <View style={styles.probeHeaderRow}>
            <View>
              <Text style={styles.probeTitle}>接口探测</Text>
              <Text style={styles.probeMeta}>GET {capabilitiesEndpoint}</Text>
              <Text style={styles.probeMeta}>GET {modelsEndpoint}</Text>
            </View>
            <Pressable
              onPress={onProbeApi}
              disabled={!apiBaseReady || probeLoading}
              style={[styles.probeBtn, (!apiBaseReady || probeLoading) && styles.btnDisabled]}
            >
              <Text style={styles.probeBtnText}>{probeLoading ? '检测中…' : '检测接口'}</Text>
            </Pressable>
          </View>

          <View style={styles.probeSummaryRow}>
            <Text style={styles.probeSummaryText}>
              chat_completions：{supportLabel(probeCapabilities?.features?.chat_completions)}
            </Text>
            <Text style={styles.probeSummaryText}>模型数：{probeModels.length}</Text>
          </View>

          {probeCheckedAt ? <Text style={styles.probeMeta}>最近检测：{probeCheckedAt}</Text> : null}

          {probeModels.length ? (
            <Text style={styles.probeModels} numberOfLines={2}>
              模型：{probeModels.join('、')}
            </Text>
          ) : null}

          {probeError ? <Text style={styles.probeError}>探测失败：{probeError}</Text> : null}
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
          ListEmptyComponent={<Text style={styles.empty}>发送第一条消息开始对话</Text>}
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
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>发送</Text>}
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
  baseHint: {
    marginTop: 6,
    fontSize: 11,
    color: '#64748b',
    lineHeight: 16,
  },
  quickBaseRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  quickBaseBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  quickBaseBtnText: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '600',
  },
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
  endpoint: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 8,
  },
  probeCard: {
    borderWidth: 1,
    borderColor: '#dbe4f0',
    backgroundColor: '#fbfdff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  probeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  probeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 3,
  },
  probeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#0f766e',
  },
  probeBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  probeMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  probeSummaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  probeSummaryText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  probeModels: {
    marginTop: 6,
    fontSize: 11,
    color: '#475569',
  },
  probeError: {
    marginTop: 6,
    color: '#b42318',
    fontSize: 11,
    lineHeight: 16,
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
