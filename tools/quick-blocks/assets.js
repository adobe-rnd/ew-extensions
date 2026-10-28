export function parseAssetPage({ assets, hasMore }, createObjectURL = URL.createObjectURL) {
  if (!Array.isArray(assets) || typeof hasMore !== 'boolean'
    || assets.some((item) => !item || typeof item !== 'object'
      || !item.asset || typeof item.asset !== 'object'
      || (typeof item.asset['repo:id'] !== 'string' && typeof item.asset.path !== 'string')
      || typeof item.name !== 'string' || !item.name.trim()
      || (item.thumbnail != null && !(item.thumbnail instanceof Blob)))) {
    throw new Error('The asset list returned invalid data.');
  }

  return {
    assets: assets.map((item) => ({
      asset: item.asset,
      name: item.name,
      thumbnailUrl: item.thumbnail ? createObjectURL(item.thumbnail) : null,
    })),
    hasMore,
  };
}
