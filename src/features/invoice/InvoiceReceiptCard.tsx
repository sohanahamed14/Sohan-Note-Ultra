import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { formatDate, formatDateTime } from '@/lib/date';
import { formatTaka } from '@/lib/money';
import { formatMethodLabel, type InvoiceData } from '@/services/invoice';
import { getSalePaymentStatus } from '@/services/sales';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AmountText, AppText, Badge, Divider } from '@/ui';

export function InvoiceReceiptCard({ data }: { data: InvoiceData }) {
  const { colors } = useTheme();
  const { sale, items, party, shop } = data;
  const dec = Boolean(shop.decimal_enabled);
  const status = getSalePaymentStatus(sale);
  const badgeTone = status === 'paid' ? 'success' : status === 'partial' ? 'warning' : 'danger';
  const badgeLabel = status === 'paid' ? 'PAID' : status === 'partial' ? 'PARTIAL DUE' : 'DUE';

  return (
    <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.topBar, { backgroundColor: colors.primary }]} />

      <View style={styles.inner}>
        {/* Shop Header */}
        <View style={styles.headerRow}>
          <View style={styles.shopInfo}>
            {shop.logo_uri ? (
              <Image
                source={{ uri: shop.logo_uri }}
                style={[styles.logo, { borderColor: colors.border }]}
                contentFit="cover"
              />
            ) : null}
            <View style={styles.flex}>
              <AppText variant="title">{shop.name}</AppText>
              {shop.phone ? (
                <AppText variant="label" muted>
                  {shop.phone}
                </AppText>
              ) : null}
              {shop.address ? (
                <AppText variant="label" muted>
                  {shop.address}
                </AppText>
              ) : null}
            </View>
          </View>
          <View style={styles.invMeta}>
            <AppText variant="label" muted bold>
              INVOICE
            </AppText>
            <AppText variant="secondary" bold>
              {sale.invoice_no}
            </AppText>
            <AppText variant="label" muted>
              {formatDateTime(sale.date)}
            </AppText>
            <View style={styles.badgeWrap}>
              <Badge label={badgeLabel} tone={badgeTone} />
            </View>
          </View>
        </View>

        <Divider />

        {/* Customer + Method */}
        <View style={styles.metaRow}>
          <View style={styles.flex}>
            <AppText variant="label" muted>
              BILLED TO
            </AppText>
            <AppText bold>{party ? party.name : 'Walk-in Customer'}</AppText>
            {party?.phone ? (
              <AppText variant="label" muted>
                {party.phone}
              </AppText>
            ) : null}
            {party?.address ? (
              <AppText variant="label" muted>
                {party.address}
              </AppText>
            ) : null}
          </View>
          <View style={styles.rightCol}>
            <AppText variant="label" muted>
              PAYMENT
            </AppText>
            <AppText bold>{formatMethodLabel(sale.method)}</AppText>
            <AppText variant="label" muted>
              {sale.kind.toUpperCase()}
            </AppText>
          </View>
        </View>

        <Divider />

        {/* Line Items */}
        <View style={styles.tableHead}>
          <AppText variant="label" muted bold style={styles.flex}>
            ITEM
          </AppText>
          <AppText variant="label" muted bold style={styles.colQty}>
            QTY
          </AppText>
          <AppText variant="label" muted bold style={styles.colAmtHead}>
            AMOUNT
          </AppText>
        </View>

        {items.map((item) => (
          <View key={item.id} style={[styles.itemRow, { borderBottomColor: colors.border }]}>
            <View style={styles.flex}>
              <AppText variant="secondary" bold>
                {item.name}
              </AppText>
              <AppText variant="label" muted>
                {formatTaka(item.unit_price, dec)} / unit
              </AppText>
              {item.warranty_until ? (
                <AppText variant="label" style={{ color: colors.accent }}>
                  Warranty until {formatDate(item.warranty_until)}
                </AppText>
              ) : null}
            </View>
            <AppText variant="secondary" style={styles.colQty}>
              {item.qty}
            </AppText>
            <View style={styles.colAmt}>
              <AmountText paisa={item.total} decimal={dec} variant="secondary" />
            </View>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsBox}>
          <View style={styles.totalLine}>
            <AppText variant="secondary" muted>
              Subtotal
            </AppText>
            <AppText variant="secondary">{formatTaka(sale.subtotal, dec)}</AppText>
          </View>
          {sale.discount > 0 ? (
            <View style={styles.totalLine}>
              <AppText variant="secondary" muted>
                Discount
              </AppText>
              <AppText variant="secondary">-{formatTaka(sale.discount, dec)}</AppText>
            </View>
          ) : null}
          {sale.vat > 0 ? (
            <View style={styles.totalLine}>
              <AppText variant="secondary" muted>
                VAT
              </AppText>
              <AppText variant="secondary">{formatTaka(sale.vat, dec)}</AppText>
            </View>
          ) : null}
          <Divider />
          <View style={styles.totalLine}>
            <AppText bold>Total</AppText>
            <AmountText paisa={sale.total} decimal={dec} />
          </View>
          <View style={styles.totalLine}>
            <AppText variant="secondary" style={{ color: colors.success }}>
              Paid ({formatMethodLabel(sale.method)})
            </AppText>
            <AmountText paisa={sale.paid} decimal={dec} tone="positive" variant="secondary" />
          </View>
          {sale.due > 0 ? (
            <View style={styles.totalLine}>
              <AppText variant="secondary" bold style={{ color: colors.danger }}>
                Due
              </AppText>
              <AmountText paisa={sale.due} decimal={dec} tone="negative" variant="secondary" />
            </View>
          ) : null}
        </View>

        {sale.note ? (
          <View
            style={[
              styles.noteBox,
              { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
            ]}
          >
            <AppText variant="label" muted>
              Note: {sale.note}
            </AppText>
          </View>
        ) : null}

        {shop.payment_qr_uri ? (
          <View style={[styles.qrBox, { borderColor: colors.border }]}>
            <Image
              source={{ uri: shop.payment_qr_uri }}
              style={styles.qrImg}
              contentFit="contain"
            />
            <AppText variant="label" muted bold>
              Scan to Pay
            </AppText>
          </View>
        ) : null}

        <View style={styles.footer}>
          {shop.invoice_footer ? (
            <AppText variant="secondary" style={styles.centerText}>
              {shop.invoice_footer}
            </AppText>
          ) : null}
          <AppText variant="label" muted style={styles.centerText}>
            Thank you for your business — Sohan Note Ultra
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderWidth: 1,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  topBar: { height: 6 },
  inner: { padding: 16, gap: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  shopInfo: { flexDirection: 'row', gap: 10, flex: 1, minWidth: 180, alignItems: 'center' },
  logo: { width: 48, height: 48, borderRadius: 8, borderWidth: 1 },
  invMeta: { alignItems: 'flex-end' },
  badgeWrap: { marginTop: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rightCol: { alignItems: 'flex-end' },
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colQty: { width: 48, textAlign: 'right' },
  colAmt: { width: 100, alignItems: 'flex-end' },
  colAmtHead: { width: 100, textAlign: 'right' },
  totalsBox: { gap: 6, paddingTop: 4 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  noteBox: { padding: 10, borderRadius: radius.row, borderWidth: 1 },
  qrBox: {
    alignSelf: 'center',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderRadius: radius.card,
    gap: 6,
  },
  qrImg: { width: 140, height: 140 },
  footer: { alignItems: 'center', gap: 4, paddingTop: 6 },
  centerText: { textAlign: 'center' },
  flex: { flex: 1 },
});
