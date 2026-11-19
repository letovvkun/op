/** Общие skeleton-шаблоны и управление доступным состоянием загрузки. */

export function setSkeletonContent(element, markup) {
  if (!element) return false;
  element.innerHTML = markup;
  element.setAttribute('aria-busy', 'true');
  return true;
}

export function clearSkeletonState(element) {
  if (!element) return;
  element.removeAttribute('aria-busy');
}

export function createSkeletonLine(className = '') {
  const modifier = className ? ` ${className}` : '';
  return `<span class="skeleton-loader skeleton-line${modifier}" aria-hidden="true"></span>`;
}

export function createEpisodeGridSkeleton(count = 8) {
  const safeCount = Math.max(1, Math.min(24, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 8)));
  return Array.from({ length: safeCount }, () => `
    <div class="ep ep-skeleton" aria-hidden="true">
      <div class="thumb skeleton-loader skeleton-episode-thumb"></div>
      <div class="meta">
        ${createSkeletonLine('skeleton-line--episode-title')}
        ${createSkeletonLine('skeleton-line--episode-subtitle')}
      </div>
    </div>
  `).join('');
}

export function createCatalogGridSkeleton(count = 6) {
  const safeCount = Math.max(1, Math.min(18, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 6)));
  return Array.from({ length: safeCount }, () => `
    <div class="catalog-card catalog-card-skeleton" aria-hidden="true">
      <div class="catalog-card-img skeleton-loader skeleton-catalog-poster"></div>
      <div class="catalog-card-info">
        ${createSkeletonLine('skeleton-line--catalog-title')}
      </div>
    </div>
  `).join('');
}

export function createTitleSearchSkeleton(count = 3) {
  const safeCount = Math.max(1, Math.min(6, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 3)));
  return Array.from({ length: safeCount }, () => `
    <div class="title-search-skeleton" aria-hidden="true">
      <span class="skeleton-loader skeleton-search-poster"></span>
      <span class="title-search-skeleton-info">
        ${createSkeletonLine('skeleton-line--search-title')}
        ${createSkeletonLine('skeleton-line--search-meta')}
      </span>
    </div>
  `).join('');
}

export function createFilterSkeleton(count = 4) {
  const safeCount = Math.max(1, Math.min(8, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 4)));
  return Array.from({ length: safeCount }, () => createSkeletonLine('skeleton-line--filter')).join('');
}

export function createTrackerTableSkeleton(count = 4) {
  const safeCount = Math.max(1, Math.min(8, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 4)));
  return Array.from({ length: safeCount }, () => `
    <tr class="tracker-skeleton-row" aria-hidden="true">
      <td><span class="skeleton-loader skeleton-table-cell skeleton-table-cell--type"></span></td>
      <td><span class="skeleton-loader skeleton-table-cell skeleton-table-cell--title"></span></td>
      <td><span class="skeleton-loader skeleton-table-cell skeleton-table-cell--date"></span></td>
      <td><span class="skeleton-loader skeleton-table-cell skeleton-table-cell--download"></span></td>
    </tr>
  `).join('');
}

export function createTextSkeleton(className = 'skeleton-line--text') {
  return createSkeletonLine(className);
}

export function createDescriptionSkeleton() {
  return `
    <span class="title-description-skeleton" aria-hidden="true">
      ${createSkeletonLine('skeleton-line--description-wide')}
      ${createSkeletonLine('skeleton-line--description-medium')}
      ${createSkeletonLine('skeleton-line--description-short')}
    </span>
  `;
}
