import { useLocalSearchParams } from 'expo-router';
import { StorefrontScreen } from '@/features/online/StorefrontScreen';

export default function PublicStorefrontRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(params.slug) ? (params.slug[0] ?? '') : (params.slug ?? '');
  return <StorefrontScreen key={slug} slug={slug} />;
}
