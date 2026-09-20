import { fetchText } from '@libs/fetch';
import { load as loadCheerio } from 'cheerio';
import { Plugin } from '@/types/plugin';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

const BASE_URL = 'https://kdtnovels.net';

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const GENRES: readonly { label: string; value: string }[] = [
  { label: 'Action', value: 'action' },
  { label: 'Adult', value: 'adult' },
  { label: 'Adventure', value: 'adventure' },
  { label: 'Battle Royale', value: 'battle-royale' },
  { label: 'Comedy', value: 'comedy' },
  { label: 'Drama', value: 'drama' },
  { label: 'Ecchi', value: 'ecchi' },
  { label: 'Fantasy', value: 'fantasy' },
  { label: 'Gender Bender', value: 'gender-bender' },
  { label: 'Genderswap', value: 'genderswap' },
  { label: 'Gore', value: 'gore' },
  { label: 'Harem', value: 'harem' },
  { label: 'Horror', value: 'horror' },
  { label: 'Idol', value: 'idol' },
  { label: 'Isekai', value: 'isekai' },
  { label: 'Isekai Reincarnation', value: 'isekai-reincarnation' },
  { label: 'Magic', value: 'magic' },
  { label: 'Martial Arts', value: 'martial-arts' },
  { label: 'Mature', value: 'mature' },
  { label: 'Mecha', value: 'mecha' },
  { label: 'Monster Girls', value: 'monster-girls' },
  { label: 'Monsters', value: 'monsters' },
  { label: 'Parallel World', value: 'parallel-world' },
  { label: 'Psychological', value: 'psychological' },
  { label: 'Psychological Drama', value: 'psychological-drama' },
  { label: 'Reincarnation', value: 'reincarnation' },
  { label: 'Romance', value: 'romance' },
  { label: 'Romance School', value: 'romance-school' },
  { label: 'Romantic Comedy', value: 'romantic-comedy' },
  { label: 'School Life', value: 'school-life' },
  { label: 'Sci-Fi', value: 'sci-fi' },
  { label: 'Seinen', value: 'seinen' },
  { label: 'Sexual Violence', value: 'sexual-violence' },
  { label: 'Shota', value: 'shota' },
  { label: 'Shoujo Ai', value: 'shoujo-ai' },
  { label: 'Shounen', value: 'shounen' },
  { label: 'Slice of Life', value: 'slice-of-life' },
  { label: 'Smut', value: 'smut' },
  { label: 'Supernatural', value: 'supernatural' },
  { label: 'Survival', value: 'survival' },
  { label: 'Time Travel', value: 'time-travel' },
  { label: 'Tragedy', value: 'tragedy' },
  { label: 'Yamikawa', value: 'yamikawa' },
  { label: 'Youth', value: 'youth' },
  { label: 'Yuri', value: 'yuri' },
];

function absolutizeUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  return url;
}

function parseNovelList(html: string): Plugin.NovelItem[] {
  const $ = loadCheerio(html);
  const novels: Plugin.NovelItem[] = [];
  $('a[href^="/series/"]').each((_, el) => {
    const $el = $(el);
    const path = $el.attr('href') || '';
    if (!path || path === '/series/') return;
    const $img = $el.find('img[src]').first();
    const rawCover = $img.attr('src') || '';
    let title = ($img.attr('alt') || '').trim();
    if (!title) {
      title = $el
        .find('h3, .line-clamp-2, span.truncate')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (!title) title = $el.text().replace(/\s+/g, ' ').trim();
    const candidate = {
      name: title || 'Untitled',
      path,
      cover: rawCover ? absolutizeUrl(rawCover) : defaultCover,
    };
    const idx = novels.findIndex(novel => novel.path === path);
    if (idx === -1) {
      novels.push(candidate);
    } else if (
      novels[idx].name === 'Untitled' ||
      (novels[idx].cover === defaultCover && candidate.cover !== defaultCover)
    ) {
      novels[idx] = candidate;
    }
  });
  return novels;
}

export class KdtNovelsPlugin implements Plugin.PluginBase {
  id = 'kdtnovels';
  name = 'KDTNovels';
  icon = 'src/en/kdtnovels/icon.png';
  site = BASE_URL;
  version = '2.1.0';
  imageRequestInit: Plugin.ImageRequestInit = {
    headers: {
      Referer: `${BASE_URL}/`,
    },
  };
  webStorageUtilized = true;

  filters: Filters = {
    status: {
      label: 'Status',
      value: '',
      options: [
        { label: 'Ongoing', value: 'ongoing' },
        { label: 'Completed', value: 'completed' },
      ],
      type: FilterTypes.Picker,
    },
    novel_type: {
      label: 'Novel Type',
      value: '',
      options: [
        { label: 'Light Novel (JP)', value: 'light-novel-jp' },
        { label: 'Web Novel', value: 'web-novel' },
      ],
      type: FilterTypes.Picker,
    },
    genres: {
      label: 'Genres',
      value: [],
      options: GENRES,
      type: FilterTypes.CheckboxGroup,
    },
  };

  pluginSettings: Filters = {
    hideLocked: {
      label: 'Hide locked chapters',
      value: false,
      type: FilterTypes.Switch,
    },
  };
  hideLocked = storage.get('hideLocked') as boolean;

  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const filters = options.filters;
    const genres = filters?.genres?.value || [];
    const status = filters?.status?.value || '';
    const novelType = filters?.novel_type?.value || '';

    let url: string;
    if (genres.length || status || novelType) {
      const params: string[] = [];
      if (genres.length) params.push(`genre=${genres.join(',')}`);
      if (status) params.push(`status=${status}`);
      if (novelType) params.push(`novel_type=${novelType}`);
      params.push(`page=${pageNo}`);
      url = `${BASE_URL}/search/?${params.join('&')}`;
    } else {
      url = pageNo === 1 ? `${BASE_URL}/` : `${BASE_URL}/?page=${pageNo}`;
    }
    return parseNovelList(await fetchText(url, { headers: REQUEST_HEADERS }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const $ = loadCheerio(
      await fetchText(absolutizeUrl(novelPath), { headers: REQUEST_HEADERS }),
    );

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name:
        $('h1.text-2xl.font-bold').first().text().replace(/\s+/g, ' ').trim() ||
        'Untitled',
      cover: defaultCover,
      status: NovelStatus.Unknown,
    };

    const preloadCover = $('link[rel="preload"][as="image"]')
      .first()
      .attr('href');
    if (preloadCover) {
      novel.cover = absolutizeUrl(preloadCover);
    } else {
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage) novel.cover = absolutizeUrl(ogImage);
    }

    const metaText = $('p.mt-1.text-sm.text-ink-dim').first().text().trim();
    const metaParts = metaText
      .split('·')
      .map(part => part.trim())
      .filter(Boolean);
    if (metaParts.length) {
      novel.author = metaParts[0];
      const artPart = metaParts.filter(part => part.startsWith('Art:')).pop();
      if (artPart) novel.artist = artPart.replace(/^Art:\s*/, '');
    }

    const genres = $('a[href^="/search/?genre="]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    if (genres.length) novel.genres = genres.join(', ');

    const summary = $('.reader-content')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    if (summary) novel.summary = summary;

    const chapters: Plugin.ChapterItem[] = [];
    const hideLocked = this.hideLocked;
    const seenChapters: string[] = [];
    $('ul.divide-y').each((_, ul) => {
      const headingMatch = $(ul)
        .closest('section')
        .find('h3')
        .first()
        .text()
        .match(/Volume\s*(\d+)/i);
      $(ul)
        .children('li')
        .each((_, li) => {
          const $li = $(li);
          const $a = $li.find('a[href]').first();
          if (!$a.length) return;
          const path = $a.attr('href') || '';
          if (!/^\/[a-z0-9-]+-ch-\d+(-\d+)?(-[a-z0-9-]+)?\/$/.test(path))
            return;
          if (seenChapters.indexOf(path) !== -1) return;
          const name = $a
            .find('span.truncate')
            .first()
            .text()
            .replace(/\s+/g, ' ')
            .trim();
          if (!name) return;
          const isLocked = $li.find('svg[aria-label="Locked"]').length > 0;
          if (isLocked && hideLocked) return;
          seenChapters.push(path);
          const volumeMatch = headingMatch || path.match(/-vol-(\d+)-/);
          const volumePrefix = volumeMatch ? `Volume ${volumeMatch[1]} · ` : '';
          const numMatch = name.match(/Ch\.\s*([\d.]+)/);
          chapters.push({
            name: isLocked
              ? `🔒 ${volumePrefix}${name}`
              : `${volumePrefix}${name}`,
            path,
            chapterNumber: numMatch ? parseFloat(numMatch[1]) : undefined,
          });
        });
    });

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = absolutizeUrl(chapterPath);
    let html = await fetchText(url, { headers: REQUEST_HEADERS });
    let $ = loadCheerio(html);
    let content = $('.text-content').first();
    if (!content.length) content = $('.reader-content').first();

    if (!content.length) {
      html = await fetchText(url, { headers: REQUEST_HEADERS });
      $ = loadCheerio(html);
      content = $('.text-content').first();
      if (!content.length) content = $('.reader-content').first();
    }

    if (!content.length) {
      const isBlocked = $('p:contains("Automated access detected")').length > 0;
      if (isBlocked) {
        throw new Error(
          'KDT Novels blocked automated access to this chapter. Try again later or open the chapter in the webview from the reader error screen.',
        );
      }
      const requiresLogin = $('a[href*="/login"]').length > 0;
      if (requiresLogin) {
        throw new Error(
          'KDT Novels requires a logged-in session to read this chapter. Open it in the webview from the reader error screen to sign in.',
        );
      }
      throw new Error(
        'Chapter content not found. The series may not have readable chapters yet.',
      );
    }

    content.find('img[src]').each((_, el) => {
      $(el).attr('src', absolutizeUrl($(el).attr('src') || ''));
    });
    content.find('img[srcset]').each((_, el) => {
      const srcset = $(el)
        .attr('srcset')
        ?.split(',')
        .map(entry => {
          const trimmed = entry.trim();
          const firstSpace = trimmed.indexOf(' ');
          const src = firstSpace > -1 ? trimmed.slice(0, firstSpace) : trimmed;
          const rest = firstSpace > -1 ? trimmed.slice(firstSpace) : '';
          return `${absolutizeUrl(src)}${rest}`;
        })
        .join(', ');
      if (srcset) $(el).attr('srcset', srcset);
    });

    return (
      content
        .html()
        ?.replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim() || ''
    );
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const url = `${BASE_URL}/search/?q=${encodeURIComponent(searchTerm)}&page=${pageNo}`;
    return parseNovelList(await fetchText(url, { headers: REQUEST_HEADERS }));
  }

  resolveUrl = (path: string) => absolutizeUrl(path);
}

export default new KdtNovelsPlugin();
