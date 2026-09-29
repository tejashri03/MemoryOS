import { useEffect, useMemo, useRef, useState } from 'react';
import { recognize } from 'tesseract.js';
import { classifyImageWithBackend, deleteImage, getImageStats, imageContentUrl, listDuplicates, listImages, listReviewImages, resolveReview, searchImages, updateImageMetadata } from '../../services/imageClassification';

const categories = [
  ['Government & Identity', 'Identity, passports and official records'],
  ['Education', 'Certificates, marksheets and study notes'],
  ['Medical & Health', 'Prescriptions and health documents'],
  ['Finance', 'Bank, tax and payment records'],
  ['Bills & Receipts', 'Invoices, receipts and utility bills'],
  ['Work & Professional', 'Resumes and office documents'],
  ['Travel', 'Tickets, trips and places'],
  ['Events & Celebrations', 'Birthdays, weddings and festivals'],
  ['People & Family', 'Portraits, family and friends'],
  ['Nature & Places', 'Landscapes, buildings and outdoors'],
  ['Animals & Pets', 'Pets and wildlife'],
  ['Food & Drinks', 'Meals, dishes and beverages'],
  ['Screenshots', 'Mobile, web and app captures'],
  ['Notes & Documents', 'Handwritten and scanned documents'],
  ['Others', 'Images needing review'],
];

const categoryAliases = {
  personal: ['People & Family', 'Events & Celebrations', 'Nature & Places', 'Animals & Pets', 'Food & Drinks'],
  photo: ['People & Family', 'Events & Celebrations', 'Nature & Places', 'Animals & Pets', 'Food & Drinks'],
  photos: ['People & Family', 'Events & Celebrations', 'Nature & Places', 'Animals & Pets', 'Food & Drinks'],
  family: ['People & Family'],
  certificate: ['Education'],
  certificates: ['Education'],
  medical: ['Medical & Health'],
  health: ['Medical & Health'],
  bills: ['Bills & Receipts'],
  receipts: ['Bills & Receipts'],
  travel: ['Travel'],
  trip: ['Travel'],
  screenshot: ['Screenshots'],
  screenshots: ['Screenshots'],
  notes: ['Notes & Documents'],
};

const stopWords = new Set(['a', 'an', 'and', 'containing', 'find', 'for', 'from', 'in', 'my', 'of', 'show', 'the']);
const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']);
const supportedImageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff']);

export default function MemoryWorkspace({ activeSection, onNavigate }) {
  const [images, setImages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderName, setFolderName] = useState('No folder selected');
  const [status, setStatus] = useState('Select a folder to start indexing.');
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('grid');
  const [sort, setSort] = useState('newest');
  const [filterCategory, setFilterCategory] = useState('All categories');
  const [filterImportance, setFilterImportance] = useState('All importance');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [location, setLocation] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [serverStats, setServerStats] = useState(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [scanCounters, setScanCounters] = useState({ processed: 0, skipped: 0, duplicates: 0, failed: 0, review: 0 });
  const [currentStage, setCurrentStage] = useState('Idle');
  const [currentFile, setCurrentFile] = useState('');
  const [recentProcessing, setRecentProcessing] = useState([]);
  const [scanTotal, setScanTotal] = useState(0);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const inputRef = useRef(null);
  const tokenRef = useRef(0);
  const urlsRef = useRef([]);

  useEffect(() => () => urlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => {
    let canceled = false;
    Promise.all([listImages({ page: 1, limit: 100 }), getImageStats()]).then(([library, statsResult]) => {
      if (canceled) return;
      setImages(library.items.map((item) => mergeSearchItem(item, [])));
      setLibraryTotal(library.total);
      setServerStats(statsResult);
    }).catch(() => { if (!canceled) setSearchError('Database connection failed. Start the backend and refresh.'); });
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    if (activeSection !== 'My Images') return undefined;
    let canceled = false;
    listImages({ page: libraryPage, limit: 100, category: filterCategory === 'All categories' ? '' : filterCategory, importance: filterImportance === 'All importance' ? '' : filterImportance }).then((library) => {
      if (canceled) return;
      setImages(library.items.map((item) => mergeSearchItem(item, [])));
      setLibraryTotal(library.total);
    }).catch(() => { if (!canceled) setSearchError('Could not load this library page.'); });
    return () => { canceled = true; };
  }, [activeSection, filterCategory, filterImportance, libraryPage]);

  useEffect(() => {
    if (activeSection !== 'Needs Review') return undefined;
    let canceled = false;
    listReviewImages().then((result) => { if (!canceled) setImages(result.items.map((item) => mergeSearchItem(item, []))); }).catch(() => { if (!canceled) setSearchError('Could not load the review queue.'); });
    return () => { canceled = true; };
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'Important') return undefined;
    let canceled = false;
    Promise.all([listImages({ page: 1, limit: 100, importance: 'Critical' }), listImages({ page: 1, limit: 100, importance: 'Important' }), listImages({ page: 1, limit: 100, protected: true })]).then((results) => {
      if (canceled) return;
      const unique = new Map(results.flatMap((result) => result.items).map((item) => [item.id, item]));
      setImages([...unique.values()].map((item) => mergeSearchItem(item, [])));
    }).catch(() => { if (!canceled) setSearchError('Could not load protected memories.'); });
    return () => { canceled = true; };
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'Duplicates') return undefined;
    let canceled = false;
    listDuplicates().then((result) => {
      if (!canceled) setDuplicateGroups(result.groups.map((group) => ({ ...group, items: group.items.map((item) => mergeSearchItem(item, [])) })));
    }).catch(() => { if (!canceled) setSearchError('Could not load duplicate groups.'); });
    return () => { canceled = true; };
  }, [activeSection]);

  const stats = useMemo(() => ({
    total: serverStats?.total ?? images.length,
    categories: serverStats?.categories?.length ?? new Set(images.map((image) => image.category)).size,
    important: serverStats?.important ?? images.filter((image) => image.importance === 'Important' || image.importance === 'Critical').length,
    duplicates: serverStats?.duplicate_groups?.length ?? findDuplicates(images).length,
    processed: serverStats?.processed ?? 0,
    pending: serverStats?.pending ?? 0,
    failed: serverStats?.failed ?? 0,
    review: serverStats?.needs_review ?? 0,
    protected: serverStats?.protected ?? 0,
    storage: serverStats?.storage_bytes ?? 0,
  }), [images, serverStats]);

  useEffect(() => {
    if (!loading) return undefined;
    const timer = window.setInterval(() => {
      getImageStats().then(setServerStats).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const visibleImages = useMemo(() => {
    const terms = searchQuery.toLowerCase().split(/\s+/).filter((term) => term && !stopWords.has(term));
    const categoryMatches = terms.flatMap((term) => categoryAliases[term] || []);
    const result = images.filter((image) => {
      const matchesCategory = filterCategory === 'All categories' || image.category === filterCategory;
      const matchesImportance = filterImportance === 'All importance' || image.importance === filterImportance;
      const haystack = [image.filename, image.category, image.ocrText, image.visualDescription, image.location].join(' ').toLowerCase();
      const matchesText = activeSection === 'Search' || terms.length === 0 || terms.every((term) => haystack.includes(term));
      const matchesAlias = categoryMatches.length > 0 && categoryMatches.includes(image.category);
      return matchesCategory && matchesImportance && (matchesText || matchesAlias);
    });

    return [...result].sort((left, right) => {
      if (sort === 'name') return left.filename.localeCompare(right.filename);
      if (sort === 'oldest') return left.lastModified - right.lastModified;
      if (sort === 'importance') return importanceRank(right.importance) - importanceRank(left.importance);
      return right.lastModified - left.lastModified;
    });
  }, [activeSection, filterCategory, filterImportance, images, searchQuery, sort]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchError('');
      return undefined;
    }
    let canceled = false;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const result = await searchImages(searchQuery, {
          category: filterCategory === 'All categories' ? '' : filterCategory,
          importance: filterImportance === 'All importance' ? '' : filterImportance,
          dateFrom,
          dateTo,
          location,
          sort: sort === 'newest' || sort === 'oldest' || sort === 'name' ? sort : 'relevance',
        });
        if (canceled) return;
        setImages((current) => mergeSearchResults(current, result.items));
        setSearchError('');
      } catch (error) {
        if (!canceled) setSearchError('Server search is unavailable; showing local indexed matches.');
      } finally {
        if (!canceled) setSearchLoading(false);
      }
    }, 250);
    return () => { canceled = true; window.clearTimeout(timer); };
  }, [dateFrom, dateTo, filterCategory, filterImportance, location, searchQuery, sort]);

  const scanFolder = async () => {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        const files = [];
        await collectFiles(handle, files);
        await indexFiles(files, handle.name || 'Selected folder');
      } catch (error) {
        if (error?.name === 'AbortError') setStatus('Folder selection canceled.');
      }
      return;
    }
    inputRef.current?.click();
  };

  const onFolderInput = async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    await indexFiles(files, files[0].webkitRelativePath?.split('/')[0] || 'Selected folder');
    event.target.value = '';
  };

  const indexFiles = async (files, label) => {
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    const supported = files.filter(isSupportedImage).sort((left, right) => right.lastModified - left.lastModified);
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    setFolderName(label);
    setLoading(true);
    setProgress(0);
    setScanTotal(supported.length);
    setStatus(`Found ${supported.length} supported images. Starting index...`);
    setScanCounters({ processed: 0, skipped: 0, duplicates: 0, failed: 0, review: 0 });
    const indexed = [];

    for (let index = 0; index < supported.length; index += 1) {
      if (tokenRef.current !== token) return;
      const file = supported[index];
      const previewUrl = URL.createObjectURL(file);
      urlsRef.current.push(previewUrl);
      setStatus(`Analyzing ${file.name} (${index + 1}/${supported.length})`);
      setCurrentStage('OCR / description / classification / embedding');
      setCurrentFile(file.name);
      let classification = null;
      let ocrText = '';
      let processingFailed = false;
      try {
        classification = await classifyImageWithBackend(file);
        ocrText = classification.ocr_text || '';
      } catch (error) {
        try {
          const result = await recognize(file, 'eng');
          ocrText = result.data.text.trim();
        } catch (ocrError) {
          ocrText = '';
          processingFailed = true;
        }
      }
      const wasReused = classification?.embedding_status === 'reused';
      const needsReview = classification?.processing_status === 'needs_review';
      setScanCounters((current) => ({ ...current, processed: current.processed + (wasReused || processingFailed ? 0 : 1), skipped: current.skipped + (wasReused ? 1 : 0), duplicates: current.duplicates + (classification?.duplicate_of ? 1 : 0), failed: current.failed + (processingFailed ? 1 : 0), review: current.review + (needsReview ? 1 : 0) }));
      indexed.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        filename: file.name,
        filePath: file.webkitRelativePath || `${label}/${file.name}`,
        fileSize: formatFileSize(file.size),
        size: file.size,
        width: 0,
        height: 0,
        fileType: getType(file),
        lastModified: file.lastModified,
        modifiedDate: formatDate(file.lastModified),
        category: classification?.category || classifyLocal(file, ocrText),
        processing_status: classification?.processing_status || (processingFailed ? 'failed' : 'completed'),
        visualDescription: classification?.visual_description || '',
        ocrText,
        keywords: buildKeywords(file, ocrText, classification?.visual_description || ''),
        importance: 'Normal',
        suggestedImportance: suggestImportance(file, ocrText),
        duplicate: false,
        previewUrl,
        location: 'Local folder',
      });
      setRecentProcessing((current) => [{ filename: file.name, category: classification?.category || 'Needs Review', status: processingFailed ? 'failed' : needsReview ? 'needs_review' : wasReused ? 'skipped' : 'completed', subcategory: classification?.subcategory || '' }, ...current].slice(0, 12));
      setProgress(Math.round(((index + 1) / supported.length) * 100));
    }
    setImages(indexed);
    setLoading(false);
    setCurrentStage('Completed');
    setCurrentFile('');
    setStatus(supported.length ? `Indexed ${supported.length} image${supported.length === 1 ? '' : 's'} from ${label}.` : 'No supported images found.');
    getImageStats().then(setServerStats).catch(() => {});
    setLibraryPage(1);
    listImages({ page: 1, limit: 100 }).then((library) => { setImages(library.items.map((item) => mergeSearchItem(item, []))); setLibraryTotal(library.total); }).catch(() => {});
  };

  const updateImage = async (id, changes) => {
    if (typeof id === 'number') {
      try { await updateImageMetadata(id, changes); } catch (error) { setSearchError('Could not save image metadata.'); return; }
    }
    setImages((current) => current.map((image) => image.id === id ? { ...image, ...changes } : image));
    setSelectedImage((current) => current?.id === id ? { ...current, ...changes } : current);
    getImageStats().then(setServerStats).catch(() => {});
  };

  const reviewImage = async (id, category) => {
    try {
      await resolveReview(id, { category });
      setImages((current) => current.map((image) => image.id === id ? { ...image, category, processing_status: 'completed' } : image));
      setSelectedImage((current) => current?.id === id ? { ...current, category, processing_status: 'completed' } : current);
      getImageStats().then(setServerStats).catch(() => {});
    } catch (error) { setSearchError('Could not save the review decision.'); }
  };

  const removeImage = async (image) => {
    if (!window.confirm(`Remove ${image.filename} from this indexed view? The original file will not be deleted.`)) return;
    if (typeof image.id === 'number') {
      try { await deleteImage(image.id, true); } catch (error) { setSearchError('Could not remove the indexed image.'); return; }
    }
    setImages((current) => current.filter((item) => item.id !== image.id));
    setSelectedImage(null);
    getImageStats().then(setServerStats).catch(() => {});
  };

  const setQueryAndSearch = (value) => {
    setSearchQuery(value.trim());
    onNavigate('Search');
  };
  const toggleSelected = (id) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const sectionTitle = activeSection === 'Dashboard' ? 'Overview' : activeSection;
  const categoryCounts = categories.map(([name, description]) => ({ name, description, count: serverStats?.categories?.find((item) => item.category === name)?.count ?? images.filter((image) => image.category === name).length, thumbnail: images.find((image) => image.category === name)?.previewUrl }));

  return (
    <div className="workspace">
      <input ref={inputRef} className="hidden-folder-input" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,image/*" directory="" webkitdirectory="" multiple onChange={onFolderInput} />
      <section className="workspace-toolbar">
        <div>
          <p className="eyebrow">{sectionTitle}</p>
          <h3>{activeSection === 'Dashboard' ? 'Your personal image memory' : sectionTitle}</h3>
          <p className="muted">{folderName === 'No folder selected' ? 'Index a local folder to unlock your library.' : `${folderName} · ${images.length} indexed images`}</p>
        </div>
        <button className="primary-button" type="button" onClick={scanFolder}><FolderIcon /> Scan Folder</button>
      </section>

      {activeSection === 'Dashboard' ? <DashboardHome stats={stats} images={visibleImages} status={status} loading={loading} progress={progress} scanTotal={scanTotal} counters={scanCounters} onNavigate={onNavigate} onSelect={setSelectedImage} categoryCounts={categoryCounts} /> : null}
      {activeSection === 'Processing' ? <ProcessingView stats={stats} loading={loading} status={status} progress={progress} counters={scanCounters} scanTotal={scanTotal} currentFile={currentFile} currentStage={currentStage} recent={recentProcessing} onScan={scanFolder} /> : null}
      {activeSection === 'Duplicates' ? <DuplicatesView groups={duplicateGroups} onSelect={setSelectedImage} onCompare={setComparison} onRemove={removeImage} onUpdate={updateImage} /> : null}
      {activeSection === 'Important' ? <ImportantView images={images} onSelect={setSelectedImage} onUpdate={updateImage} /> : null}
      {activeSection === 'Needs Review' ? <ReviewQueue images={images} onSelect={setSelectedImage} onReview={reviewImage} /> : null}
      {activeSection === 'Categories' ? <CategoriesView counts={categoryCounts} onChoose={(category) => { setFilterCategory(category); onNavigate('My Images'); }} /> : null}
      {activeSection === 'Security' ? <SecurityView /> : null}
      {activeSection === 'Settings' ? <SettingsView /> : null}
      {['My Images', 'Search', 'Recent'].includes(activeSection) ? (
        <LibraryView
          activeSection={activeSection}
          images={visibleImages}
          allImages={images}
          searchQuery={searchQuery}
          setSearchQuery={setQueryAndSearch}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterImportance={filterImportance}
          setFilterImportance={setFilterImportance}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          location={location}
          setLocation={setLocation}
          sort={sort}
          setSort={setSort}
          view={view}
          setView={setView}
          status={status}
          loading={loading}
          progress={progress}
          onScan={scanFolder}
          onSelect={setSelectedImage}
          onUpdate={updateImage}
          onRemove={removeImage}
          onReview={reviewImage}
          searchLoading={searchLoading}
          searchError={searchError}
          libraryPage={libraryPage}
          libraryTotal={libraryTotal}
          onLibraryPage={setLibraryPage}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
        />
      ) : null}

      {selectedImage ? <DetailsPanel image={selectedImage} onClose={() => setSelectedImage(null)} onUpdate={updateImage} onRemove={removeImage} onReview={reviewImage} /> : null}
      {comparison ? <ComparisonPanel images={comparison} onClose={() => setComparison(null)} /> : null}
    </div>
  );
}

function DashboardHome({ stats, images, status, loading, progress, scanTotal, counters, onNavigate, onSelect, categoryCounts }) {
  return <>
    <div className="summary-grid">
      <SummaryCard label="Total images" value={stats.total} detail="Indexed locally" />
      <SummaryCard label="Processed" value={stats.processed} detail="Ready to search" />
      <SummaryCard label="Processing" value={stats.pending} detail="Waiting or indexing" />
      <SummaryCard label="Failed" value={stats.failed} detail="Need another attempt" />
      <SummaryCard label="Needs review" value={stats.review} detail="Low confidence or ambiguous" />
      <SummaryCard label="Duplicate groups" value={stats.duplicates} detail="Review before removing" />
      <SummaryCard label="Protected" value={stats.protected} detail="Protected memories" />
      <SummaryCard label="Important" value={stats.important} detail="Critical and important" />
    </div>
    <section className="live-processing surface-panel"><div className="panel-heading"><div><p className="eyebrow">{loading ? 'Live processing' : 'Indexing'}</p><h4>{loading ? 'MemoryOS is indexing your library' : 'Your library is ready when you are'}</h4></div><button className="text-button" type="button" onClick={() => onNavigate('Processing')}>Open processing</button></div>{loading ? <><div className="live-progress-line"><strong>{counters.processed + counters.skipped + counters.failed} / {scanTotal} processed</strong><span>{progress}%</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><p className="live-current"><span className="pulse-dot" /> {status}</p></> : <p className="muted">Scan a folder to see OCR, visual understanding, and categorization progress here.</p>}</section>
    <div className="dashboard-columns">
      <section className="surface-panel">
        <div className="panel-heading"><div><p className="eyebrow">Recent images</p><h4>Recently indexed</h4></div><button className="text-button" type="button" onClick={() => onNavigate('My Images')}>View all</button></div>
        {loading ? <ProgressState status={status} progress={progress} counters={counters} /> : images.length ? <ImageGrid images={images.slice(0, 6)} onSelect={onSelect} /> : <EmptyState title="Your library starts here" text="Select a local folder and MemoryOS will index the image intelligence once." />}
      </section>
      <section className="surface-panel category-panel"><div className="panel-heading"><div><p className="eyebrow">Categories</p><h4>Browse your memory</h4></div><button className="text-button" type="button" onClick={() => onNavigate('Categories')}>All categories</button></div><div className="category-list">{categoryCounts.filter((item) => item.count).slice(0, 6).map((item) => <button type="button" className="category-row" key={item.name} onClick={() => onNavigate('Categories')}><span className="category-dot" /><span>{item.name}</span><strong>{item.count}</strong></button>)}{!categoryCounts.some((item) => item.count) ? <EmptyState title="No categories yet" text="Categories appear after indexing images." /> : null}</div></section>
    </div>
  </>;
}

function LibraryView({ activeSection, images, allImages, searchQuery, setSearchQuery, filterCategory, setFilterCategory, filterImportance, setFilterImportance, dateFrom, setDateFrom, dateTo, setDateTo, location, setLocation, sort, setSort, view, setView, status, loading, progress, onScan, onSelect, onUpdate, onRemove, onReview, searchLoading, searchError, libraryPage, libraryTotal, onLibraryPage, selectedIds, onToggleSelected }) {
  const sectionImages = activeSection === 'Search' && !searchQuery.trim() ? [] : activeSection === 'Important' ? images.filter((image) => image.importance === 'Important' || image.importance === 'Critical') : activeSection === 'Duplicates' ? findDuplicates(images) : activeSection === 'Recent' ? [...images].sort((a, b) => b.lastModified - a.lastModified) : images;
  return <section className="surface-panel library-panel">
    <div className={activeSection === 'Search' ? 'search-hero' : 'library-heading'}><div>{activeSection === 'Search' ? <><p className="eyebrow">AI memory search</p><h4>Find a memory by what you remember</h4><p className="muted">Search text in images, visual meaning, categories, and keywords.</p></> : <><p className="eyebrow">{activeSection}</p><h4>{`${sectionImages.length} image${sectionImages.length === 1 ? '' : 's'}`}</h4></>}</div>{activeSection !== 'Search' ? <button className="primary-button compact" type="button" onClick={onScan}><FolderIcon /> Scan Folder</button> : null}</div>
    <div className={activeSection === 'Search' ? 'library-controls ai-search-controls' : 'library-controls'}><label className={activeSection === 'Search' ? 'library-search ai-search-input' : 'library-search'}><SearchIcon active={false} /><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={activeSection === 'Search' ? 'Search your memories...' : 'Filter filenames, text, descriptions...'} /></label>{activeSection === 'Search' ? null : <><select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}><option>All categories</option>{categories.map(([name]) => <option key={name}>{name}</option>)}</select><select value={filterImportance} onChange={(event) => setFilterImportance(event.target.value)}><option>All importance</option><option>Critical</option><option>Important</option><option>Normal</option><option>Low</option></select><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Date from" /><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Date to" /><input type="search" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Location" aria-label="Location" /><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Filename</option><option value="importance">Importance</option></select><div className="view-toggle"><button className={view === 'grid' ? 'selected' : ''} type="button" onClick={() => setView('grid')} aria-label="Grid view">▦</button><button className={view === 'list' ? 'selected' : ''} type="button" onClick={() => setView('list')} aria-label="List view">☷</button></div></>}</div>
    {activeSection === 'Search' && !searchQuery ? <div className="search-suggestions"><span>Try a search</span>{['engineering certificate', 'dog photos', 'Goa trip', 'electricity bills'].map((query) => <button type="button" key={query} onClick={() => setSearchQuery(query)}>{query}</button>)}</div> : null}
    {searchLoading ? <ProgressState status="Searching OCR, keywords, descriptions, and visual embeddings..." progress={65} /> : null}
    {searchError ? <p className="scan-status">{searchError}</p> : null}
    {activeSection === 'My Images' && selectedIds.size ? <p className="selection-count">{selectedIds.size} image{selectedIds.size === 1 ? '' : 's'} selected</p> : null}
    {loading ? <ProgressState status={status} progress={progress} /> : sectionImages.length ? view === 'grid' ? <ImageGrid images={sectionImages} onSelect={onSelect} onUpdate={onUpdate} onRemove={onRemove} explainMatches={activeSection === 'Search'} selectable={activeSection === 'My Images'} selectedIds={selectedIds} onToggleSelected={onToggleSelected} /> : <ImageTable images={sectionImages} onSelect={onSelect} onUpdate={onUpdate} onRemove={onRemove} /> : <EmptyState title={activeSection === 'Needs Review' ? 'No images need review' : allImages.length ? 'No matching images' : 'No images indexed'} text={allImages.length ? 'Try a different search or filter.' : 'Select a folder to build your library.'} />}
    {activeSection === 'My Images' && libraryTotal > 100 ? <div className="pagination-controls"><span>Showing {(libraryPage - 1) * 100 + 1}–{Math.min(libraryPage * 100, libraryTotal)} of {libraryTotal}</span><div><button type="button" disabled={libraryPage <= 1} onClick={() => onLibraryPage((page) => Math.max(1, page - 1))}>Previous</button><strong>Page {libraryPage} of {Math.ceil(libraryTotal / 100)}</strong><button type="button" disabled={libraryPage >= Math.ceil(libraryTotal / 100)} onClick={() => onLibraryPage((page) => page + 1)}>Next</button></div></div> : null}
  </section>;
}

function ImageGrid({ images, onSelect, onUpdate, onRemove, explainMatches = false, selectable = false, selectedIds = new Set(), onToggleSelected }) {
  return <div className="image-grid">{images.map((image) => <article className="image-card" key={image.id}>{selectable ? <label className="image-select"><input type="checkbox" checked={selectedIds.has(image.id)} onChange={() => onToggleSelected(image.id)} aria-label={`Select ${image.filename}`} /></label> : null}<button type="button" className="image-preview" onClick={() => onSelect(image)}><img src={image.previewUrl} alt="" loading="lazy" /></button><div className="image-card-body"><button type="button" className="image-name" onClick={() => onSelect(image)}>{image.filename}</button><span className="image-category">{image.category}{image.subcategory ? ` · ${image.subcategory}` : ''}</span>{image.protection_status === 'protected' ? <small className="protection-reason">Marked protected by you</small> : image.importance === 'Critical' || image.importance === 'Important' ? <small className="protection-reason">Marked important by you</small> : null}{explainMatches ? <div className="match-reasons">{image.match_reason?.ocr?.length ? <span>OCR match</span> : null}{image.match_reason?.semantic ? <span>Semantic match</span> : null}{image.match_reason?.category?.length ? <span>Category match</span> : null}{image.match_reason?.keywords?.length ? <span>Keyword match</span> : null}</div> : null}<div className="image-meta"><span>{image.processing_status === 'needs_review' ? 'Needs review' : image.modifiedDate}</span><span aria-label={image.protection_status === 'protected' ? 'Protected' : 'Unprotected'}>{image.protection_status === 'protected' ? 'Protected' : ''}</span><button type="button" className={image.importance === 'Important' || image.importance === 'Critical' ? 'star-button active' : 'star-button'} onClick={() => onUpdate?.(image.id, { importance: image.importance === 'Important' ? 'Normal' : 'Important' })} aria-label="Toggle important">★</button></div></div></article>)}</div>;
}

function ImageTable({ images, onSelect, onUpdate, onRemove }) {
  return <div className="image-table-wrap"><table className="image-table"><thead><tr><th>Name</th><th>Category</th><th>Importance</th><th>Modified</th><th>Type</th><th /></tr></thead><tbody>{images.map((image) => <tr key={image.id}><td><button type="button" className="table-name" onClick={() => onSelect(image)}><span className="table-thumb"><img src={image.previewUrl} alt="" /></span>{image.filename}</button></td><td><span className="category-label">{image.category}</span></td><td><select value={image.importance} onChange={(event) => onUpdate?.(image.id, { importance: event.target.value })}><option>Critical</option><option>Important</option><option>Normal</option><option>Low</option></select></td><td>{image.modifiedDate}</td><td>{image.fileType}</td><td><button className="more-button" type="button" onClick={() => onRemove?.(image)}>Remove index</button></td></tr>)}</tbody></table></div>;
}

function CategoriesView({ counts, onChoose }) {
  return <section className="surface-panel"><div className="library-heading"><div><p className="eyebrow">Browse by meaning</p><h4>15 memory categories</h4></div><span className="muted">Choose a group to see its images</span></div><div className="category-card-grid">{counts.map((item) => <button type="button" className="category-card" key={item.name} onClick={() => onChoose(item.name)}>{item.thumbnail ? <img className="category-thumbnail" src={item.thumbnail} alt="" loading="lazy" /> : <span className="category-icon">{item.name.slice(0, 1)}</span>}<strong>{item.name}</strong><span>{item.description}</span><b>{item.count} images</b></button>)}</div></section>;
}

function ProcessingView({ stats, loading, status, progress, counters, scanTotal, currentFile, currentStage, recent, onScan }) {
  const done = counters.processed + counters.skipped + counters.failed;
  return <section className="processing-page">
    <section className="surface-panel processing-hero"><div className="panel-heading"><div><p className="eyebrow">Indexing progress</p><h4>{loading ? 'MemoryOS is working through your files' : 'Ready to index your memories'}</h4><p className="muted">{loading ? status : 'Start a folder scan to read text, understand images, and build searchable categories.'}</p></div><button className="primary-button" type="button" onClick={onScan}><FolderIcon /> Scan Folder</button></div><div className="processing-count"><strong>{loading ? `${done} / ${scanTotal}` : `${stats.processed} / ${stats.total}`}</strong><span>{loading ? 'files handled in this scan' : 'images processed in your library'}</span></div><div className="progress-track"><span style={{ width: `${loading ? progress : (stats.total ? Math.round(stats.processed / stats.total * 100) : 0)}%` }} /></div><div className="stage-track">{['OCR', 'Description', 'Classification', 'Embedding', 'Saved'].map((stage, index) => <span key={stage} className={loading ? 'stage active' : 'stage'}><i>{index + 1}</i>{stage}</span>)}</div><p className="processing-current"><span className={loading ? 'pulse-dot' : 'status-dot'} /> <strong>Current file:</strong> {currentFile || 'Waiting for next scan'} <span className="stage-label">{currentStage}</span></p></section>
    <div className="processing-counters"><SummaryCard label="Processed" value={counters.processed} detail="New images indexed" /><SummaryCard label="Skipped" value={counters.skipped} detail="Already indexed" /><SummaryCard label="Duplicates" value={counters.duplicates} detail="Detected groups" /><SummaryCard label="Needs review" value={counters.review} detail="Awaiting confirmation" /><SummaryCard label="Failed" value={counters.failed} detail="Could not process" /></div>
    <section className="surface-panel processing-stream"><div className="panel-heading"><div><p className="eyebrow">Recent activity</p><h4>Processing stream</h4></div><span className={loading ? 'live-badge live' : 'live-badge'}>{loading ? 'Live' : 'Idle'}</span></div>{recent.length ? <ol>{recent.map((item, index) => <li key={`${item.filename}-${index}`}><span className={`stream-status ${item.status}`}>{item.status === 'needs_review' ? '!' : item.status === 'failed' ? '×' : item.status === 'skipped' ? '↷' : '✓'}</span><span><strong>{item.filename}</strong><small>{item.status === 'needs_review' ? 'Needs Review' : item.status === 'failed' ? 'Failed' : item.status === 'skipped' ? 'Skipped — already indexed' : `${item.category}${item.subcategory ? ` / ${item.subcategory}` : ''}`}</small></span></li>)}</ol> : <EmptyState title="No recent processing" text="New files will appear here as the indexer handles them." />}</section>
  </section>;
}

function DuplicatesView({ groups, onSelect, onCompare, onRemove, onUpdate }) {
  return <section className="surface-panel duplicates-page"><div className="library-heading"><div><p className="eyebrow">Review before cleanup</p><h4>{groups.length} duplicate group{groups.length === 1 ? '' : 's'}</h4><p className="muted">MemoryOS never removes an image automatically.</p></div></div>{groups.length ? groups.map((group, index) => <article className="duplicate-group" key={group.fingerprint}><div className="duplicate-group-heading"><strong>Duplicate Group {String(index + 1).padStart(2, '0')}</strong><span>{group.type === 'exact_duplicate' ? 'Same file · 100%' : `${group.similarity}% visual similarity`}</span><button className="text-button" type="button" onClick={() => onCompare(group.items.slice(0, 2))}>Compare</button></div><div className="duplicate-items">{group.items.map((image) => <article className="duplicate-item" key={image.id}><button className="image-preview" type="button" onClick={() => onSelect(image)}><img src={image.previewUrl} alt="" loading="lazy" /></button><strong>{image.filename}</strong><small>{image.fileSize} · {image.modifiedDate}</small><div><button className="text-button" type="button" onClick={() => onSelect(image)}>View</button><button className="text-button" type="button" onClick={() => onUpdate(image.id, { protection_status: 'protected' })}>Keep</button><button className="danger-button" type="button" onClick={() => onRemove(image)}>Delete</button></div></article>)}</div></article>) : <EmptyState title="No duplicate groups found" text="When MemoryOS finds identical or visually similar images, they will appear here for review." />}</section>;
}

function ComparisonPanel({ images, onClose }) {
  if (!images?.length) return null;
  return <div className="modal-backdrop comparison-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="comparison-panel" role="dialog" aria-modal="true"><button className="close-button" type="button" onClick={onClose} aria-label="Close comparison">×</button><p className="eyebrow">Side by side</p><h4>Compare duplicate images</h4><div>{images.map((image) => <article key={image.id}><img src={image.previewUrl} alt={image.filename} /><strong>{image.filename}</strong><small>{image.fileSize} · {image.modifiedDate}</small></article>)}</div></section></div>;
}

function ImportantView({ images, onSelect, onUpdate }) {
  const critical = images.filter((image) => image.importance === 'Critical');
  const important = images.filter((image) => image.importance === 'Important');
  const protectedImages = images.filter((image) => image.protection_status === 'protected');
  return <section className="important-page"><div className="important-intro surface-panel"><p className="eyebrow">Your protected memories</p><h4>Keep the moments and records that matter close.</h4><div className="important-counts"><span><strong>{critical.length}</strong> Critical</span><span><strong>{important.length}</strong> Important</span><span><strong>{protectedImages.length}</strong> Protected</span></div></div>{[['Critical', critical], ['Important', important], ['Protected', protectedImages]].map(([label, entries]) => <section className="surface-panel important-group" key={label}><div className="panel-heading"><div><p className="eyebrow">{label}</p><h4>{entries.length} saved memory{entries.length === 1 ? '' : 'ies'}</h4></div></div>{entries.length ? <ImageGrid images={entries} onSelect={onSelect} onUpdate={onUpdate} /> : <p className="muted">No {label.toLowerCase()} memories here yet.</p>}</section>)}</section>;
}

function ReviewQueue({ images, onSelect, onReview }) {
  return <section className="surface-panel review-page"><div className="library-heading"><div><p className="eyebrow">Human confirmation</p><h4>These images need your confirmation</h4><p className="muted">The classifier found close or weak evidence and left the category open for your choice.</p></div></div>{images.length ? <div className="review-list">{images.map((image) => {
    const candidates = image.classification_candidates || [];
    const suggested = candidates[0];
    const alternative = candidates[1];
    return <article className="review-card" key={image.id}><button type="button" className="review-thumb" onClick={() => onSelect(image)}><img src={image.previewUrl} alt="" loading="lazy" /></button><div className="review-info"><strong>{image.filename}</strong><p>This image needs your confirmation.</p><div className="review-suggestion"><span>Suggested: <b>{suggested?.category || image.category}</b>{suggested ? ` · score ${suggested.score.toFixed(2)}` : ''}</span>{alternative ? <span>Alternative: <b>{alternative.category}</b> · score {alternative.score.toFixed(2)}</span> : null}</div><small>Why uncertain: {suggested && alternative ? `the top two category scores are only ${Math.round(Math.abs(suggested.score - alternative.score) * 100)} points apart.` : 'The text and visual signals were too weak to choose a category.'}</small></div><div className="review-actions">{suggested ? <button className="primary-button compact" type="button" onClick={() => onReview(image.id, suggested.category)}>Confirm {suggested.category}</button> : null}{candidates.slice(1).map((candidate) => <button className="text-button" type="button" key={candidate.category} onClick={() => onReview(image.id, candidate.category)}>Choose {candidate.category}</button>)}</div></article>;
  })}</div> : <EmptyState title="Review queue is clear" text="Images with uncertain categories will show here for your confirmation." />}</section>;
}

function SecurityView() {
  return <section className="surface-panel settings-panel"><p className="eyebrow">Privacy by design</p><h4>Security & local processing</h4><p className="muted">Your original image files remain in their local folders. MemoryOS stores extracted intelligence and paths for fast retrieval.</p><div className="security-list"><SecurityRow label="Local processing" value="ON" good /><SecurityRow label="Cloud upload" value="OFF" good /><SecurityRow label="OCR & AI metadata" value="Protected locally" good /><SecurityRow label="Database connection" value="Configure MySQL" /></div></section>;
}

function SettingsView() {
  const sections = [
    ['Account', 'Local user', 'This workspace is configured for a single local account.'],
    ['Privacy', 'Local-first indexing', 'Images are sent to the configured local MemoryOS backend for analysis and stored in MySQL.'],
    ['AI Models', 'OCR · BLIP · OpenCLIP', 'Model availability and model names are configured with backend environment variables.'],
    ['Indexing', 'Sequential, responsive scan', 'The current scan processes one image at a time and reuses results for unchanged files.'],
    ['Search', 'Text + semantic retrieval', 'Search uses OCR, descriptions, keywords, categories, and available image embeddings.'],
    ['Storage', 'MySQL image library', 'Original image bytes and extracted metadata are stored in the configured database.'],
    ['Database', 'Backend environment', 'Connection values are managed in backend/.env. Restart the API after changing them.'],
  ];
  return <section className="settings-page"><div className="settings-intro"><p className="eyebrow">Configuration</p><h4>MemoryOS settings</h4><p className="muted">Review how this workspace is configured.</p></div><div className="settings-section-grid">{sections.map(([title, value, description]) => <article className="surface-panel settings-section-card" key={title}><p className="eyebrow">{title}</p><strong>{value}</strong><p>{description}</p></article>)}</div></section>;
}

function DetailsPanel({ image, onClose, onUpdate, onRemove, onReview }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="details-panel" role="dialog" aria-modal="true"><button className="close-button" type="button" onClick={onClose} aria-label="Close details">×</button><img className="details-preview" src={image.previewUrl || imageContentUrl(image.id)} alt={image.filename} /><div className="details-content"><p className="eyebrow">Image details</p><h4>{image.filename}</h4><span className="category-label">{image.category}{image.subcategory ? ` · ${image.subcategory}` : ''}</span><dl><dt>Path</dt><dd>{image.filePath || 'Stored in MemoryOS'}</dd><dt>File type</dt><dd>{image.fileType || image.mime_type} · {image.fileSize || formatFileSize(image.file_size)}</dd><dt>Modified</dt><dd>{image.modifiedDate || image.created_at}</dd><dt>Location</dt><dd>{image.location || 'Not set'}</dd><dt>Confidence</dt><dd>{image.confidence ? `${Math.round(image.confidence * 100)}%` : 'Needs review'}</dd><dt>Score margin</dt><dd>{image.classification_margin == null ? 'Unavailable' : `${Math.round(image.classification_margin * 100)} points`}</dd><dt>OCR confidence</dt><dd>{image.ocr_confidence == null ? 'Unavailable' : `${Math.round(image.ocr_confidence * 100)}%`}</dd><dt>Importance</dt><dd><select value={image.importance || 'Normal'} onChange={(event) => onUpdate(image.id, { importance: event.target.value })}><option>Critical</option><option>Important</option><option>Normal</option><option>Low</option></select></dd><dt>Protection</dt><dd><button type="button" className="text-button" onClick={() => onUpdate(image.id, { protection_status: image.protection_status === 'protected' ? 'unprotected' : 'protected' })}>{image.protection_status === 'protected' ? 'Protected · Unprotect' : 'Unprotected · Protect'}</button></dd></dl>{image.processing_status === 'needs_review' ? <div className="details-section"><strong>Suggested categories</strong><div>{(image.classification_candidates || []).map((candidate) => <button key={candidate.category} type="button" className="text-button" onClick={() => onReview(image.id, candidate.category)}>{candidate.category} ({Math.round(candidate.score * 100)}%)</button>)}</div></div> : null}<EvidenceView image={image} /><div className="details-section"><strong>AI description</strong><p>{image.visualDescription || image.visual_description || 'No visual description returned.'}</p></div><div className="details-section"><strong>Keywords</strong><p>{image.keywords || 'No keywords stored.'}</p></div><div className="details-section"><strong>Extracted text</strong><p>{image.ocrText || image.ocr_text || 'No text detected.'}</p>{image.ocr_confidence < 0.7 ? <small>Low OCR confidence: text may contain recognition errors.</small> : null}</div><div className="details-section technical-details"><strong>Technical details</strong><dl><dt>File size</dt><dd>{image.fileSize || formatFileSize(image.file_size)}</dd><dt>Resolution</dt><dd>{image.image_width && image.image_height ? `${image.image_width} × ${image.image_height}` : 'Unavailable'}</dd><dt>SHA-256</dt><dd>{image.file_hash || 'Unavailable'}</dd><dt>pHash</dt><dd>{image.phash || 'Unavailable'}</dd><dt>Processing</dt><dd>{image.processing_status || 'completed'}</dd></dl></div><div className="details-actions"><button className="primary-button" type="button" onClick={() => navigator.clipboard?.writeText(image.filePath || image.filename)}>Copy path</button><button className="danger-button" type="button" onClick={() => onRemove(image)}>Remove index</button></div></div></aside></div>;
}

function EvidenceView({ image }) {
  const categoryEvidence = image.classification_evidence?.[image.category];
  const matches = categoryEvidence?.matches;
  const items = matches ? Object.entries(matches).flatMap(([source, values]) => values.map((item) => ({ ...item, source }))) : [];
  return <div className="details-section"><strong>Classification evidence</strong>{items.length ? <ul className="evidence-list">{items.slice(0, 12).map((item, index) => <li key={`${item.source}-${item.match}-${index}`}><span className={item.strength}>{item.weight >= 0 ? '+' : '−'}</span> “{item.match}” · {item.source}{item.strength === 'strong' ? ' · strong' : item.strength === 'conflict' ? ' · conflicting' : ' · supporting'}</li>)}</ul> : <p>Detailed evidence is available for images indexed after this update.</p>}</div>;
}

function SummaryCard({ label, value, detail }) { return <article className="summary-card"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>; }
function SecurityRow({ label, value, good }) { return <div className="security-row"><span>{label}</span><strong className={good ? 'good' : ''}>{value}</strong></div>; }
function ProgressState({ status, progress, counters }) { return <div className="progress-state"><strong>{status}</strong><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><small>{progress}% complete · {counters ? `Processed ${counters.processed} · Skipped ${counters.skipped} · Failed ${counters.failed} · Needs review ${counters.review}` : 'Processing remains local'}</small></div>; }
function EmptyState({ title, text }) { return <div className="empty-state"><strong>{title}</strong><p>{text}</p></div>; }
function FolderIcon() { return <svg viewBox="0 0 24 24" className="button-icon" aria-hidden="true"><path d="M3.8 7.5h6l1.7 2h8.7v8.7a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8V7.5Z" /><path d="M3.8 7.5V5.8A1.8 1.8 0 0 1 5.6 4h4l1.7 2h6.9" /></svg>; }
function SearchIcon({ active }) { return <svg viewBox="0 0 24 24" className={active ? 'nav-icon active-icon' : 'nav-icon'} aria-hidden="true"><circle cx="11" cy="11" r="5.5" /><path d="M15.5 15.5 20 20" /></svg>; }
function isSupportedImage(file) { return supportedImageTypes.has(file.type) || supportedImageExtensions.has(file.name.split('.').pop()?.toLowerCase()); }
async function collectFiles(directory, target) { for await (const [, handle] of directory.entries()) { if (handle.kind === 'file') target.push(await handle.getFile()); else if (handle.kind === 'directory') await collectFiles(handle, target); } }
function getType(file) { const extension = file.name.split('.').pop()?.toUpperCase(); return extension === 'JPG' ? 'JPEG' : extension || file.type.replace('image/', '').toUpperCase(); }
function formatFileSize(bytes) { if (bytes < 1024) return `${bytes} B`; const units = ['KB', 'MB', 'GB']; let value = bytes / 1024; let index = 0; while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; } return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`; }
function formatDate(timestamp) { return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
function classifyLocal(file, text) { const source = `${file.name} ${text}`.toLowerCase(); const strongReceipt = /receipt|invoice|subtotal|amount due|order total|payment receipt|gst|barcode|quantity|discount|cashier/.test(source); const strongFinance = /bank statement|account statement|income certificate|income cert|income tax|tax return|credit card|ifsc|account number|transaction id/.test(source); const strongIdentity = /(^|[ _-])id([ _-]|\.)|id card|identity card|id proof|identity proof|government id|national id|aadhaar card|pan card|voter id|driving licence|driver license/.test(source); if (strongReceipt) return 'Bills & Receipts'; if (strongIdentity) return 'Government & Identity'; if (strongFinance) return 'Finance'; const rules = [['Government & Identity', /aadhaar|passport|identity|voter|nationality|dob|address/], ['Medical & Health', /prescription|medical|hospital|doctor|patient/], ['Travel', /boarding pass|flight|ticket|train|hotel|airport|itinerary|trip/], ['Education', /marksheet|mark sheet|degree|diploma|transcript|report card|semester|grade|exam|university|college|school/], ['Work & Professional', /resume|offer letter|office|company/], ['Events & Celebrations', /birthday|wedding|party|festival/], ['Screenshots', /screenshot|screen capture|mobile|website|chat/], ['Notes & Documents', /document|scan|note|handwritten/]]; return rules.find(([, pattern]) => pattern.test(source))?.[0] || 'Others'; }
function buildKeywords(file, text, description) { return [...new Set(`${file.name} ${text} ${description}`.toLowerCase().match(/[a-z0-9]+/g) || [])].slice(0, 12).join(', '); }
function suggestImportance(file, text) { return /passport|aadhaar|medical|prescription|certificate|tax|bank/.test(`${file.name} ${text}`.toLowerCase()) ? 'Important' : 'Normal'; }
function importanceRank(value) { return { Critical: 4, Important: 3, Normal: 2, Low: 1 }[value] || 0; }
function findDuplicates(images) { const groups = new Map(); images.forEach((image) => { const key = `${image.size}-${image.fileType}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(image); }); const duplicates = []; groups.forEach((group) => { if (group.length > 1) duplicates.push(...group.slice(1)); }); return duplicates; }
function mergeSearchItem(item, current) { return { ...item, id: item.id, previewUrl: imageContentUrl(item.id), fileSize: formatFileSize(item.file_size), fileType: getType({ name: item.filename, type: item.mime_type }), modifiedDate: item.file_modified_at ? formatDate(item.file_modified_at) : (item.created_at ? formatDate(item.created_at) : ''), ocrText: item.ocr_text || '', visualDescription: item.visual_description || '', keywords: item.keywords || '', lastModified: item.file_modified_at ? Date.parse(item.file_modified_at) : (item.created_at ? Date.parse(item.created_at) : 0), filePath: item.file_path || current.find((image) => image.id === item.id)?.filePath || '', location: item.location || 'Not set', importance: item.importance || 'Normal', protection_status: item.protection_status || 'unprotected', processing_status: item.processing_status || 'completed' }; }
function mergeSearchResults(current, results) { return results.map((item) => mergeSearchItem(item, current)); }
