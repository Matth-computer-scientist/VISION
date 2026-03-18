import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API_BASE_URL = "http://localhost:8080";

type UserProfile = {
  display_name: string;
  email: string;
  role: string;
};

type JobRecord = {
  job_id: string;
  kind: string;
  status: string;
  progress: number;
  message?: string | null;
};

async function readJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${path}`);
  }

  return (await response.json()) as T;
}

export default function App() {
  const [email, setEmail] = useState("admin@vision.local");
  const [password, setPassword] = useState("vision123");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setUser(null);
      setJobs([]);
      return;
    }

    Promise.all([
      readJson<UserProfile>("/api/v1/auth/me", token),
      readJson<JobRecord[]>("/api/v1/jobs", token),
    ])
      .then(([nextUser, nextJobs]) => {
        setUser(nextUser);
        setJobs(nextJobs);
      })
      .catch(() => {
        setError("Unable to reach the backend from mobile.");
        setToken(null);
      });
  }, [token]);

  async function signIn() {
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error("Authentication failed.");
      }

      const payload = (await response.json()) as { token: string; user: UserProfile };
      setToken(payload.token);
      setUser(payload.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed.");
    }
  }

  function signOut() {
    setToken(null);
    setUser(null);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Vision Mobile</Text>
          <Text style={styles.title}>Connected backend monitoring.</Text>
          <Text style={styles.body}>
            Mobile now authenticates against the Rust API and reads the persistent job queue.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in</Text>
          {!user ? (
            <>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <Pressable style={styles.button} onPress={signIn}>
                <Text style={styles.buttonText}>Connect to backend</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.userName}>{user.display_name}</Text>
              <Text style={styles.userText}>{user.email}</Text>
              <Text style={styles.userText}>Role: {user.role}</Text>
              <Pressable style={styles.button} onPress={signOut}>
                <Text style={styles.buttonText}>Sign out</Text>
              </Pressable>
            </>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Jobs</Text>
          {jobs.map((job) => (
            <View key={job.job_id} style={styles.jobCard}>
              <View style={styles.jobHeader}>
                <Text style={styles.jobTitle}>{job.kind}</Text>
                <Text style={styles.jobStatus}>{job.status}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.max(6, job.progress)}%` }]} />
              </View>
              <Text style={styles.jobMeta}>{job.progress}%</Text>
              {job.message ? <Text style={styles.jobMeta}>{job.message}</Text> : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f1e8",
  },
  container: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 16,
  },
  hero: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 24,
  },
  eyebrow: {
    color: "#d97706",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 12,
    color: "#102a43",
    fontSize: 30,
    fontWeight: "700",
  },
  body: {
    marginTop: 14,
    color: "#52606d",
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 20,
  },
  cardTitle: {
    color: "#102a43",
    fontSize: 22,
    fontWeight: "700",
  },
  input: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  button: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: "#102a43",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  userName: {
    marginTop: 14,
    color: "#102a43",
    fontSize: 20,
    fontWeight: "700",
  },
  userText: {
    marginTop: 8,
    color: "#52606d",
    fontSize: 15,
  },
  error: {
    marginTop: 12,
    color: "#b42318",
    fontSize: 14,
  },
  jobCard: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: "#f8fafc",
    padding: 16,
  },
  jobHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  jobTitle: {
    color: "#102a43",
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
  },
  jobStatus: {
    color: "#52606d",
    fontSize: 12,
    textTransform: "uppercase",
  },
  track: {
    marginTop: 12,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#d9e2ec",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#102a43",
  },
  jobMeta: {
    marginTop: 10,
    color: "#52606d",
    fontSize: 14,
  },
});
