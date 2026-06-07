let blobLib = null;

function isBlobEnabled() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function getBlob() {
  if (!isBlobEnabled()) return null;
  if (!blobLib) {
    blobLib = await import('@vercel/blob');
  }
  return blobLib;
}

async function put(pathname, data, options = {}) {
  const blob = await getBlob();
  if (!blob) {
    throw new Error('BLOB_READ_WRITE_TOKEN not set — Blob storage is not configured');
  }
  return blob.put(pathname, data, { access: 'public', ...options });
}

async function list(options = {}) {
  const blob = await getBlob();
  if (!blob) return { blobs: [], cursor: undefined };
  return blob.list(options);
}

async function del(pathOrUrl) {
  const blob = await getBlob();
  if (!blob) return null;
  return blob.del(pathOrUrl);
}

module.exports = { isBlobEnabled, put, list, del };
