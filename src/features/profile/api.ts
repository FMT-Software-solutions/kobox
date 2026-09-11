import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { supabase } from '@/lib/supabase';

export interface Profile {
  id: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
}

/**
 * The longest edge an avatar is stored at, and the JPEG quality it is encoded
 * with. 512px at 0.7 lands around 40-60 KB — small enough that a member on a
 * slow connection is not paying for someone else's 4 MB camera roll, and still
 * sharp on the largest place we render it.
 */
const AVATAR_SIZE = 512;
const AVATAR_QUALITY = 0.7;

export async function fetchMyProfile(): Promise<Profile | null> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, avatar_url')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    fullName: data.full_name ?? '',
    phone: data.phone,
    avatarUrl: data.avatar_url,
  };
}

export async function setMyName(fullName: string) {
  const { error } = await supabase.rpc('set_my_name', { p_full_name: fullName });
  if (error) throw error;
}

/**
 * Shrinks, re-encodes and uploads a picked image, then points the profile at it.
 *
 * The resize is not a nicety. A phone camera roll image is routinely 3-5 MB;
 * uploading that raw would be slow to send, slow to render for every member who
 * sees it, and would blow the bucket's 2 MB ceiling outright.
 */
export async function uploadMyAvatar(localUri: string): Promise<string> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error('You must be signed in to change your picture');

  const context = ImageManipulator.manipulate(localUri).resize({ width: AVATAR_SIZE });
  const rendered = await context.renderAsync();
  const image = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: AVATAR_QUALITY,
  });

  // React Native's fetch returns a Blob for a file:// URI, which is what the
  // storage client wants. ArrayBuffer avoids a Hermes Blob-size quirk where an
  // empty file uploads silently.
  const response = await fetch(image.uri);
  const bytes = await response.arrayBuffer();

  if (bytes.byteLength === 0) {
    throw new Error('That image could not be read. Try another one.');
  }

  // A new filename every time, so a cached old avatar can never be shown in
  // place of a new one. The folder is the uid — the storage policies key off it.
  const path = `${auth.user.id}/${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from('avatars').getPublicUrl(path);

  const { error } = await supabase.rpc('set_my_avatar', { p_avatar_url: publicUrl });
  if (error) throw error;

  return publicUrl;
}

export async function clearMyAvatar() {
  const { error } = await supabase.rpc('set_my_avatar', { p_avatar_url: '' });
  if (error) throw error;
}
