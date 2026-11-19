import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText } from './AppText';
import { Button } from './Buttons';

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Back',
  destructive,
  loading,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.backdrop, styles.center, { backgroundColor: colors.overlay }]}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <AppText variant="title" style={{ color: destructive ? colors.danger : colors.accent }}>
            {title}
          </AppText>
          {message ? <AppText muted>{message}</AppText> : null}
          <View style={styles.actions}>
            <Button label={cancelLabel} variant="outline" onPress={onCancel} style={styles.flex} />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              loading={loading}
              onPress={onConfirm}
              style={styles.flex}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.flex} accessibilityLabel="Close" onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          {title ? <AppText variant="title">{title}</AppText> : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type ToastType = 'success' | 'error' | 'info';
type ToastApi = { show: (message: string, type?: ToastType) => void };
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback((message: string, type: ToastType = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  const bg =
    toast?.type === 'error'
      ? colors.danger
      : toast?.type === 'success'
        ? colors.success
        : '#333333';
  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View style={[styles.toast, { backgroundColor: bg }]}>
            <AppText variant="secondary" style={{ color: '#FFFFFF' }}>
              {toast.message}
            </AppText>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1 },
  center: { justifyContent: 'center', padding: 24 },
  dialog: {
    borderRadius: radius.card,
    padding: 20,
    gap: 12,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 12,
    maxHeight: '85%',
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  toastWrap: { position: 'absolute', left: 16, right: 16, bottom: 48, alignItems: 'center' },
  toast: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, maxWidth: 480 },
});
