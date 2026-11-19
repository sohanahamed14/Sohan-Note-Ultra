import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Platform, Share, StyleSheet, View } from 'react-native';
import { db, expoDb } from '@/db/client';
import { active } from '@/db/helpers';
import { sales } from '@/db/schema';
import { errorMessage } from '@/lib/errors';
import { InvoiceReceiptCard } from '@/features/invoice/InvoiceReceiptCard';
import { CollectDueSheet } from '@/features/sell/CollectDueSheet';
import {
  buildInvoiceShareText,
  printInvoice,
  shareInvoicePdf,
  type InvoiceData,
} from '@/services/invoice';
import { can } from '@/services/permissions';
import { deleteSale, getSaleById } from '@/services/sales';
import { useCurrentShop } from '@/store/useCurrentShop';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  EmptyState,
  Loading,
  Screen,
  useToast,
  type HeaderAction,
} from '@/ui';

function normalizeBdWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('01')) return `88${digits}`;
  if (digits.length >= 10) return digits;
  return null;
}

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shopId, role, requireShop } = useCurrentShop();
  const toast = useToast();

  const [busyAction, setBusyAction] = useState<'share' | 'print' | null>(null);
  const [collectOpen, setCollectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const saleId = typeof id === 'string' ? id : '';

  const { updatedAt, error } = useLiveQuery(
    expoDb
      .select({ id: sales.id, paid: sales.paid, due: sales.due, updated_at: sales.updated_at })
      .from(sales)
      .where(and(active(sales, shopId ?? ''), eq(sales.id, saleId))),
    [shopId, saleId],
  );

  const detail = useMemo(() => {
    if (!shopId || !saleId) return null;
    void updatedAt;
    return getSaleById(db, shopId, saleId);
  }, [shopId, saleId, updatedAt]);

  const invoiceData: InvoiceData | null =
    detail && detail.shop
      ? { sale: detail.sale, items: detail.items, party: detail.party, shop: detail.shop }
      : null;

  const canDelete = can(role, 'delete');
  const canCollect = can(role, 'collectDue');

  const headerRight: HeaderAction[] =
    invoiceData && canDelete
      ? [{ icon: 'delete-outline', label: 'Delete sale', onPress: () => setDeleteOpen(true) }]
      : [];

  if (!shopId || !role) {
    return (
      <Screen header={<AppHeader title="Invoice" />} scroll={false}>
        <Loading label="Loading invoice..." />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen header={<AppHeader title="Invoice" />} scroll={false}>
        <EmptyState icon="alert-circle-outline" title="Failed to load invoice" message={error.message} />
      </Screen>
    );
  }

  if (!invoiceData) {
    return (
      <Screen header={<AppHeader title="Invoice" />} scroll={false}>
        <EmptyState
          icon="receipt-text-outline"
          title="Invoice not found"
          message="This sale may have been deleted or belongs to another shop."
          action={{ label: 'Go to Sales Ledger', onPress: () => router.replace('/sales') }}
        />
      </Screen>
    );
  }

  const handleSharePdf = async () => {
    try {
      setBusyAction('share');
      if (Platform.OS === 'web') {
        await printInvoice(invoiceData);
      } else {
        await shareInvoicePdf(invoiceData);
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePrint = async () => {
    try {
      setBusyAction('print');
      await printInvoice(invoiceData);
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleWhatsApp = async () => {
    const text = buildInvoiceShareText(invoiceData);
    const waPhone = normalizeBdWhatsApp(invoiceData.party?.phone);
    const url = waPhone
      ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return;
      }
      await Share.share({ message: text });
    } catch {
      try {
        await Share.share({ message: text });
      } catch (e) {
        toast.show(errorMessage(e), 'error');
      }
    }
  };

  const handleDelete = () => {
    try {
      const ctx = requireShop();
      deleteSale(db, ctx, invoiceData.sale.id);
      setDeleteOpen(false);
      toast.show('Sale moved to Recycle Bin', 'success');
      if (router.canGoBack()) router.back();
      else router.replace('/sales');
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  return (
    <Screen header={<AppHeader title={invoiceData.sale.invoice_no} right={headerRight} />}>
      <InvoiceReceiptCard data={invoiceData} />

      <View style={styles.actionsRow}>
        <Button
          label="Share PDF"
          icon="share-variant-outline"
          variant="primary"
          loading={busyAction === 'share'}
          disabled={busyAction !== null}
          onPress={handleSharePdf}
          style={styles.flex}
        />
        <Button
          label="Print"
          icon="printer-outline"
          variant="outline"
          loading={busyAction === 'print'}
          disabled={busyAction !== null}
          onPress={handlePrint}
          style={styles.flex}
        />
      </View>

      <View style={styles.actionsRow}>
        <Button
          label="WhatsApp"
          icon="whatsapp"
          variant="outline"
          onPress={handleWhatsApp}
          style={styles.flex}
        />
        {invoiceData.sale.due > 0 && canCollect ? (
          <Button
            label="Collect Due"
            icon="cash-plus"
            variant="yellow"
            onPress={() => setCollectOpen(true)}
            style={styles.flex}
          />
        ) : (
          <Button
            label="New Sale"
            icon="cart-plus"
            variant="yellow"
            onPress={() => router.replace('/sell')}
            style={styles.flex}
          />
        )}
      </View>

      {invoiceData.sale.due > 0 && canCollect ? (
        <Button
          label="New Sale"
          icon="cart-plus"
          variant="ghost"
          fullWidth
          onPress={() => router.replace('/sell')}
        />
      ) : null}

      <CollectDueSheet
        sale={collectOpen ? invoiceData.sale : null}
        customerName={invoiceData.party?.name}
        onClose={() => setCollectOpen(false)}
      />

      <ConfirmDialog
        visible={deleteOpen}
        title="Delete Sale?"
        message="This moves the sale to Recycle Bin and reverses stock, cash, and customer due."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionsRow: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
