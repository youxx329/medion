import type { Database } from './database.types';

type ProductRow = Database['public']['Tables']['products']['Row'];

/** 목록·카드에 필요한 칸만. queries.ts 의 LIST_COLUMNS 와 같아야 한다 */
export type Product = Pick<
  ProductRow,
  'id' | 'code' | 'name' | 'price' | 'image_key' | 'dosage_form' | 'child_min_age_months' | 'stock'
>;
