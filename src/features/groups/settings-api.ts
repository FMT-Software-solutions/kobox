/**
 * Who a group is and what it looks like.
 *
 * These writes go straight to the `groups` table, and that is safe only because
 * `20260911010000` replaced the table-wide UPDATE grant with a per-column one:
 * an admin may change the name, description, logo and brand colour, and cannot
 * reach `currency`, `sms_sender_id` or `join_code` from here however the
 * request is shaped.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { BrandKey } from '@/lib/brand';
import { supabase } from '@/lib/supabase';

/** Same pipeline as avatars: small, square, re-encoded before it leaves the phone. */
const LOGO_SIZE = 512;
const LOGO_QUALITY = 0.75;

export const DESCRIPTION_LIMIT = 280;
export const NAME_LIMIT = 60;

export interface GroupProfile {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  brandColour: BrandKey | null;
  currency: string;
  createdAt: string;
}

export async function fetchGroupProfile(groupId: string): Promise<GroupProfile> {
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, description, logo_url, brand_colour, currency, created_at')
    .eq('id', groupId)
    .single();

  if (error) throw error;

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    logoUrl: data.logo_url,
    brandColour: data.brand_colour as BrandKey | null,
    currency: data.currency,
    createdAt: data.created_at,
  };
}

export async function updateGroupProfile(input: {
  groupId: string;
  name?: string;
  description?: string | null;
  brandColour?: BrandKey | null;
}) {
  // Only the columns an admin is granted (20260911010000). Typed, so a field
  // outside that grant is a compile error here rather than a 403 at runtime.
  const patch: { name?: string; description?: string | null; brand_colour?: string | null } = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) {
    // An emptied box means "no description", not a description of nothing.
    patch.description = input.description?.trim() ? input.description.trim() : null;
  }
  if (input.brandColour !== undefined) patch.brand_colour = input.brandColour;

  const { error } = await supabase.from('groups').update(patch).eq('id', input.groupId);
  if (error) throw error;
}

/**
 * Shrinks, re-encodes and uploads a logo, then points the group at it.
 *
 * The first folder of the path is the group id — that is what the storage
 * policies check the admin role against. A new filename every time, so a cached
 * old logo is never shown in place of a new one.
 */
export async function uploadGroupLogo(input: { groupId: string; localUri: string }) {
  const context = ImageManipulator.manipulate(input.localUri).resize({ width: LOGO_SIZE });
  const rendered = await context.renderAsync();
  const image = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: LOGO_QUALITY });

  // ArrayBuffer, not Blob: Hermes can upload an empty Blob without complaint.
  const bytes = await (await fetch(image.uri)).arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error('That image could not be read. Try another one.');
  }

  const path = `${input.groupId}/${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('group-logos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from('group-logos').getPublicUrl(path);

  const { error } = await supabase
    .from('groups')
    .update({ logo_url: publicUrl })
    .eq('id', input.groupId);
  if (error) throw error;

  return publicUrl;
}

export async function clearGroupLogo(groupId: string) {
  const { error } = await supabase.from('groups').update({ logo_url: null }).eq('id', groupId);
  if (error) throw error;
}
