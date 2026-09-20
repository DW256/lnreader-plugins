import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';

class Secre implements Plugin.PluginBase {
  id = 'secre';
  name = 'Secre';
  icon = 'src/en/secre/icon.png';
  site = 'https://secreftls.com';
  version = '1.0.0';

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetchApi(this.site + '/api' + path);
    return res.json() as Promise<T>;
  }

  private async getCatalog(): Promise<Plugin.NovelItem[]> {
    const [series, books] = await Promise.all([
      this.getJson<SeriesItem[]>('/series'),
      this.getJson<BooksResponse>('/books?per_page=500'),
    ]);

    const items: Plugin.NovelItem[] = [];

    for (const s of series) {
      if (!s.slug) continue;
      items.push({
        name: s.title,
        path: 's/' + s.slug,
        cover: s.cover_image || defaultCover,
      });
    }

    for (const b of books.data || []) {
      if (b.series_id || !b.slug) continue;
      items.push({
        name: b.title,
        path: 'b/' + b.slug,
        cover: b.cover_image || defaultCover,
      });
    }

    return items;
  }

  private getVolumeLabel(title: string, seriesOrder = 0): string {
    const volume = /volume\s+[\w.-]+/i.exec(title || '');
    if (volume && volume[0]) {
      const label = volume[0].trim();
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
    if (seriesOrder >= 1) return 'Volume ' + seriesOrder;
    return title || 'Book';
  }

  private async getBookChapters(book: {
    slug?: string;
    title: string;
    series_order?: number;
  }): Promise<Plugin.ChapterItem[]> {
    if (!book.slug) return [];

    const page = await this.getJson<ChaptersResponse>(
      '/books/' + book.slug + '/chapters?per_page=500',
    );

    const volumeLabel = this.getVolumeLabel(book.title, book.series_order);
    const chapters: Plugin.ChapterItem[] = [];

    const data = [...(page.data || [])].sort(
      (a, b) => (a.chapter_weight || 0) - (b.chapter_weight || 0),
    );

    for (const ch of data) {
      if (ch.status && ch.status.name !== 'published') continue;
      const name = ch.chapter_title || ch.chapter_slug;
      if (!name) continue;
      chapters.push({
        name: volumeLabel + ' · ' + name,
        path: book.slug + '/' + ch.chapter_slug,
        releaseTime: ch.created_at ? ch.created_at.slice(0, 10) : undefined,
      });
    }

    return chapters;
  }

  private applyChapterNumbers(
    chapters: Plugin.ChapterItem[],
  ): Plugin.ChapterItem[] {
    return chapters.map((chapter, index) => ({
      ...chapter,
      chapterNumber: index + 1,
    }));
  }

  async popularNovels(
    pageNo: number,
    { showLatestNovels }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    if (showLatestNovels) {
      const latest = await this.getJson<LatestChapter[]>('/latest-chapters');
      const seen = new Set<string>();
      const items: Plugin.NovelItem[] = [];

      for (const ch of latest) {
        const seriesSlug = ch.book && ch.book.series && ch.book.series.slug;
        if (!seriesSlug || seen.has(seriesSlug)) continue;
        seen.add(seriesSlug);
        items.push({
          name:
            (ch.book && ch.book.series && ch.book.series.title) ||
            (ch.book && ch.book.title) ||
            'Untitled',
          path: 's/' + seriesSlug,
          cover: (ch.book && ch.book.cover_image) || defaultCover,
        });
      }

      return items;
    }

    return this.getCatalog();
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const term = searchTerm.toLowerCase();
    const items = await this.getCatalog();

    return items.filter(item => item.name.toLowerCase().includes(term));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    if (novelPath.startsWith('s/')) {
      return this.parseSeries(novelPath, novelPath.slice(2));
    }

    // Entries without a series prefix are standalone books.
    const slug = novelPath.startsWith('b/') ? novelPath.slice(2) : novelPath;

    const detail = await this.getJson<BookDetail>('/books/' + slug);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: detail.title || 'Untitled',
      cover: detail.cover_image || defaultCover,
      summary: detail.description,
      genres: (detail.tags || [])
        .map(tag => tag.display_name || tag.name)
        .join(', '),
      author: detail.author || detail.illustrator || undefined,
      status:
        detail.status && detail.status.name === 'finished'
          ? NovelStatus.Completed
          : NovelStatus.Ongoing,
    };

    const chapters = await this.getBookChapters(detail);
    novel.chapters = this.applyChapterNumbers(chapters);

    return novel;
  }

  private async parseSeries(
    novelPath: string,
    slug: string,
  ): Promise<Plugin.SourceNovel> {
    const series = await this.getJson<SeriesDetail>('/series/' + slug);

    const books = [...(series.books || [])].sort(
      (a, b) => (a.series_order || 0) - (b.series_order || 0),
    );

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: series.title || 'Untitled',
      cover: series.cover_image || defaultCover,
      summary: series.description,
      genres: (series.tags || [])
        .map(tag => tag.display_name || tag.name)
        .join(', '),
    };

    if (books.length > 0) {
      novel.author = books[0].author || books[0].illustrator || undefined;
      const allFinished = books.every(
        book => book.status && book.status.name === 'finished',
      );
      const anyDropped = books.some(
        book => book.status && book.status.name === 'dropped',
      );
      novel.status = allFinished
        ? NovelStatus.Completed
        : anyDropped
          ? NovelStatus.Inactive
          : NovelStatus.Ongoing;
    }

    const chapters: Plugin.ChapterItem[] = [];
    for (const book of books) {
      const bookChapters = await this.getBookChapters(book);
      chapters.push(...bookChapters);
    }
    novel.chapters = this.applyChapterNumbers(chapters);

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const separator = chapterPath.lastIndexOf('/');
    const bookSlug = chapterPath.slice(0, separator);
    const chapterSlug = chapterPath.slice(separator + 1);

    const detail = await this.getJson<ChapterDetail>(
      '/books/' + bookSlug + '/chapters/' + chapterSlug,
    );

    const body = (detail.body || '').trim();
    if (body) {
      // The editor stores images with site-relative /storage paths; make them
      // absolute so they resolve inside LNReader's reader.
      return body
        .replace(/src="\//g, 'src="' + this.site + '/')
        .replace(/src='\//g, "src='" + this.site + '/');
    }

    const images = detail.images || [];
    if (images.length > 0) {
      return images
        .map(image => {
          const src = image.url || image.image_path;
          if (!src) return '';
          const url = src.startsWith('http') ? src : this.site + src;
          return '<img src="' + url + '" alt="' + (image.alt_text || '') + '">';
        })
        .join('');
    }

    return '';
  }

  resolveUrl = (path: string, isNovel?: boolean) => {
    if (path.startsWith('s/')) {
      return this.site + '/collections/' + path.slice(2);
    }
    if (path.startsWith('b/')) {
      return this.site + '/books/' + path.slice(2);
    }
    return this.site + (isNovel ? '/books/' : '/') + path;
  };
}

export default new Secre();

type Status = {
  name: string;
  display_name?: string;
};

type SeriesItem = {
  title: string;
  description?: string;
  cover_image?: string | null;
  slug?: string;
  tags?: { name: string; display_name?: string }[];
};

type Book = {
  slug?: string;
  title: string;
  description?: string;
  author?: string | null;
  illustrator?: string | null;
  cover_image?: string | null;
  series_id?: number | null;
  series_order?: number;
  status?: Status | null;
  tags?: { name: string; display_name?: string }[];
};

type BookDetail = Book;

type SeriesDetail = SeriesItem & {
  books?: Book[];
};

type BooksResponse = {
  data?: Book[];
};

type ChaptersResponse = {
  data?: Chapter[];
};

type Chapter = {
  chapter_title?: string;
  chapter_slug?: string;
  created_at?: string;
  chapter_weight?: number;
  status?: Status | null;
};

type ChapterDetail = Chapter & {
  body?: string;
  images?: ChapterImage[];
};

type ChapterImage = {
  url?: string;
  image_path?: string;
  alt_text?: string;
};

type LatestChapter = {
  book?: {
    title: string;
    cover_image?: string | null;
    series?: { slug?: string; title?: string } | null;
  };
};
