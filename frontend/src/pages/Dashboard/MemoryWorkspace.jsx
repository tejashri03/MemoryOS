import { useEffect, useMemo, useRef, useState } from 'react';
import { recognize } from 'tesseract.js';
import { classifyImageWithBackend, deleteImageFromBackend, updateImageImportance } from '../../services/imageClassification';

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
  const [selectedImage, setSelectedImage] = useState(null);
  const inputRef = useRef(null);
  const tokenRef = useRef(0);
  const urlsRef = useRef([]);

  useEffect(() => () => urlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const stats = useMemo(() => ({
    total: images.length,
    categories: new Set(images.map((image) => image.category)).size,
    important: images.filter((image) => image.importance === 'Important' || image.importance === 'Critical').length,
    duplicates: findDuplicates(images).length,
  }), [images]);

  const visibleImages = useMemo(() => {
    const terms = searchQuery.toLowerCase().split(/\s+/).filter((term) => term && !stopWords.has(term));
    const categoryMatches = terms.flatMap((term) => categoryAliases[term] || []);
    const result = images.filter((image) => {
      const matchesCategory = filterCategory === 'All categories' || image.category === filterCategory;
      const matchesImportance = filterImportance === 'All importance' || image.importance === filterImportance;
      const haystack = [image.filename, image.category, image.ocrText, image.visualDescription, image.location].join(' ').toLowerCase();
      const matchesText = terms.length === 0 || terms.every((term) => haystack.includes(term));
      const matchesAlias = categoryMatches.length > 0 && categoryMatches.includes(image.category);
      return matchesCategory && matchesImportance && (matchesText || matchesAlias);
    });

    return [...result].sort((left, right) => {
      if (sort === 'name') return left.filename.localeCompare(right.filename);
      if (sort === 'oldest') return left.lastModified - right.lastModified;
      if (sort === 'importance') return importanceRank(right.importance) - importanceRank(left.importance);
      return right.lastModified - left.lastModified;
    });
  }, [filterCategory, filterImportance, images, searchQuery, sort]);

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
    setImages([]);
    setFolderName(label);
    setLoading(true);
    setProgress(0);
    setStatus(`Found ${supported.length} supported images. Starting index...`);
    const indexed = [];

    for (let index = 0; index < supported.length; index += 1) {
      if (tokenRef.current !== token) return;
      const file = supported[index];
      const previewUrl = URL.createObjectURL(file);
      urlsRef.current.push(previewUrl);
      setStatus(`Comparing ${file.name} with indexed images (${index + 1}/${supported.length})`);
      const duplicateFingerprint = await buildDuplicateFingerprint(file);
      const duplicateMatch = findDuplicateMatch(duplicateFingerprint, indexed);
      setStatus(`Analyzing ${file.name} (${index + 1}/${supported.length})`);
      let classification = null;
      let ocrText = '';
      try {
        classification = await classifyImageWithBackend(file);
        ocrText = classification.ocr_text || '';
      } catch (error) {
        try {
          const result = await recognize(file, 'eng');
          ocrText = result.data.text.trim();
        } catch (ocrError) {
          ocrText = '';
        }
      }
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
        visualDescription: classification?.visual_description || '',
        ocrText,
        keywords: buildKeywords(file, ocrText, classification?.visual_description || ''),
        importance: classification?.importance_level || getLocalImportanceLevel(classification?.category || classifyLocal(file, ocrText), file, ocrText),
        importanceScore: classification?.importance_score ?? getLocalImportanceScore(classification?.category || classifyLocal(file, ocrText), file, ocrText),
        protectionStatus: classification?.protection_status ?? isLocallyProtected(classification?.category || classifyLocal(file, ocrText), file, ocrText),
        protectionReason: classification?.protection_reason || '',
        importanceBreakdown: classification?.importance_breakdown || {},
        userMarkedImportant: classification?.user_marked_important || false,
        suggestedImportance: suggestImportance(file, ocrText),
        duplicate: Boolean(duplicateMatch),
        duplicateOf: duplicateMatch?.filename || null,
        duplicateReason: duplicateMatch?.reason || '',
        duplicateFingerprint,
        previewUrl,
        location: 'Local folder',
      });
      setImages([...indexed]);
      setProgress(Math.round(((index + 1) / supported.length) * 100));
    }
    setLoading(false);
    setStatus(supported.length ? `Indexed ${supported.length} image${supported.length === 1 ? '' : 's'} from ${label}.` : 'No supported images found.');
  };

  const updateImage = (id, changes) => {
    setImages((current) => current.map((image) => image.id === id ? { ...image, ...changes } : image));
    setSelectedImage((current) => current?.id === id ? { ...current, ...changes } : current);
  };

  const setImportant = async (image, important) => {
    try {
      if (Number.isInteger(image.id)) {
        const updated = await updateImageImportance(image.id, important);
        updateImage(image.id, {
          importance: updated.importance_level,
          importanceScore: updated.importance_score,
          protectionStatus: updated.protection_status,
          protectionReason: updated.protection_reason,
          importanceBreakdown: updated.importance_breakdown || {},
          userMarkedImportant: updated.user_marked_important,
        });
      } else {
        updateImage(image.id, { importance: important ? 'Important' : 'Normal', userMarkedImportant: important, protectionStatus: important, importanceScore: important ? 25 : image.importanceScore });
      }
    } catch (error) {
      window.alert(error.message);
    }
  };

  const removeImage = async (image) => {
    if (image.protectionStatus) {
      window.alert(`Deletion blocked: ${image.protectionReason || 'this image is protected.'}`);
      return;
    }
    const requiresConfirmation = image.importanceScore >= 60 && image.importanceScore < 80;
    if (requiresConfirmation && !window.confirm(`${image.filename} is ${image.importance} (${image.importanceScore}/100). Delete it?`)) return;
    if (!requiresConfirmation && !window.confirm(`Remove ${image.filename} from this indexed view? The original file will not be deleted.`)) return;
    try {
      if (Number.isInteger(image.id)) await deleteImageFromBackend(image.id, requiresConfirmation);
      setImages((current) => current.filter((item) => item.id !== image.id));
      setSelectedImage(null);
    } catch (error) {
      window.alert(error.message);
    }
  };

  const setQueryAndSearch = (value) => {
    setSearchQuery(value.trim());
    onNavigate('Search');
  };

  const sectionTitle = activeSection === 'Dashboard' ? 'Overview' : activeSection;
  const categoryCounts = categories.map(([name, description]) => ({ name, description, count: images.filter((image) => image.category === name).length }));

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

      {activeSection === 'Dashboard' ? <DashboardHome stats={stats} images={visibleImages} status={status} loading={loading} progress={progress} onNavigate={onNavigate} onSelect={setSelectedImage} categoryCounts={categoryCounts} /> : null}
      {activeSection === 'Categories' ? <CategoriesView counts={categoryCounts} onChoose={(category) => { setFilterCategory(category); onNavigate('My Images'); }} /> : null}
      {activeSection === 'Security' ? <SecurityView /> : null}
      {activeSection === 'Settings' ? <SettingsView /> : null}
      {['My Images', 'Search', 'Important', 'Duplicates', 'Recent'].includes(activeSection) ? (
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
          onSetImportant={setImportant}
          onRemove={removeImage}
        />
      ) : null}

      {selectedImage ? <DetailsPanel image={selectedImage} onClose={() => setSelectedImage(null)} onUpdate={updateImage} onRemove={removeImage} /> : null}
    </div>
  );
}

function DashboardHome({ stats, images, status, loading, progress, onNavigate, onSelect, categoryCounts }) {
  return <>
    <div className="summary-grid">
      <SummaryCard label="Total images" value={stats.total} detail="Indexed locally" />
      <SummaryCard label="Categories" value={stats.categories} detail="Semantic groups found" />
      <SummaryCard label="Important images" value={stats.important} detail="Critical and important" />
      <SummaryCard label="Duplicates found" value={stats.duplicates} detail="Review recommended" />
    </div>
    <div className="dashboard-columns">
      <section className="surface-panel">
        <div className="panel-heading"><div><p className="eyebrow">Recent images</p><h4>Recently indexed</h4></div><button className="text-button" type="button" onClick={() => onNavigate('My Images')}>View all</button></div>
        {loading ? <ProgressState status={status} progress={progress} /> : images.length ? <ImageGrid images={images.slice(0, 6)} onSelect={onSelect} /> : <EmptyState title="Your library starts here" text="Select a local folder and MemoryOS will index the image intelligence once." />}
      </section>
      <section className="surface-panel category-panel"><div className="panel-heading"><div><p className="eyebrow">Categories</p><h4>Browse your memory</h4></div><button className="text-button" type="button" onClick={() => onNavigate('Categories')}>All categories</button></div><div className="category-list">{categoryCounts.filter((item) => item.count).slice(0, 6).map((item) => <button type="button" className="category-row" key={item.name} onClick={() => onNavigate('Categories')}><span className="category-dot" /><span>{item.name}</span><strong>{item.count}</strong></button>)}{!categoryCounts.some((item) => item.count) ? <EmptyState title="No categories yet" text="Categories appear after indexing images." /> : null}</div></section>
    </div>
  </>;
}

function LibraryView({ activeSection, images, allImages, searchQuery, setSearchQuery, filterCategory, setFilterCategory, filterImportance, setFilterImportance, sort, setSort, view, setView, status, loading, progress, onScan, onSelect, onUpdate, onSetImportant, onRemove }) {
  const sectionImages = activeSection === 'Important' ? images.filter((image) => image.importance === 'Important' || image.importance === 'Critical') : activeSection === 'Duplicates' ? findDuplicates(images) : activeSection === 'Recent' ? [...images].sort((a, b) => b.lastModified - a.lastModified) : images;
  return <section className="surface-panel library-panel">
    <div className="library-heading"><div><p className="eyebrow">{activeSection}</p><h4>{activeSection === 'Search' ? 'Search your indexed memory' : `${sectionImages.length} image${sectionImages.length === 1 ? '' : 's'}`}</h4></div><button className="primary-button compact" type="button" onClick={onScan}><FolderIcon /> Scan Folder</button></div>
    <div className="library-controls"><label className="library-search"><SearchIcon active={false} /><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search OCR, categories, descriptions, filenames..." /></label><select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}><option>All categories</option>{categories.map(([name]) => <option key={name}>{name}</option>)}</select><select value={filterImportance} onChange={(event) => setFilterImportance(event.target.value)}><option>All importance</option><option>Critical</option><option>Important</option><option>Normal</option><option>Low</option></select><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Filename</option><option value="importance">Importance</option></select><div className="view-toggle"><button className={view === 'grid' ? 'selected' : ''} type="button" onClick={() => setView('grid')} aria-label="Grid view">▦</button><button className={view === 'list' ? 'selected' : ''} type="button" onClick={() => setView('list')} aria-label="List view">☷</button></div></div>
    {loading ? <ProgressState status={status} progress={progress} /> : sectionImages.length ? view === 'grid' ? <ImageGrid images={sectionImages} onSelect={onSelect} onSetImportant={onSetImportant} /> : <ImageTable images={sectionImages} onSelect={onSelect} onSetImportant={onSetImportant} onRemove={onRemove} /> : <EmptyState title={allImages.length ? 'No matching images' : 'No images indexed'} text={allImages.length ? 'Try a different search or filter.' : 'Select a folder to build your library.'} />}
  </section>;
}

function ImageGrid({ images, onSelect, onSetImportant }) {
  return <div className="image-grid">{images.map((image) => <article className={image.protectionStatus ? 'image-card protected-card' : 'image-card'} key={image.id}><button type="button" className="image-preview" onClick={() => onSelect(image)}><img src={image.previewUrl} alt="" loading="lazy" /></button><div className="image-card-body"><button type="button" className="image-name" onClick={() => onSelect(image)}>{image.filename}</button><span className="image-category">{image.category}</span>{image.duplicate ? <span className="duplicate-badge">Duplicate of {image.duplicateOf}</span> : null}<div className="importance-badge"><strong>{image.importance}</strong><span>{image.importanceScore}/100</span></div><div className="image-meta"><span>{image.protectionStatus ? 'Protected' : 'Unprotected'}</span><button type="button" className={image.userMarkedImportant ? 'star-button active' : 'star-button'} onClick={() => onSetImportant?.(image, !image.userMarkedImportant)} aria-label="Toggle important">★</button></div></div></article>)}</div>;
}

function ImageTable({ images, onSelect, onSetImportant, onRemove }) {
  return <div className="image-table-wrap"><table className="image-table"><thead><tr><th>Name</th><th>Category</th><th>Importance</th><th>Protection</th><th>Modified</th><th>Type</th><th /></tr></thead><tbody>{images.map((image) => <tr key={image.id}><td><button type="button" className="table-name" onClick={() => onSelect(image)}><span className="table-thumb"><img src={image.previewUrl} alt="" /></span>{image.filename}</button></td><td><span className="category-label">{image.category}</span></td><td><button type="button" className={image.userMarkedImportant ? 'table-importance active' : 'table-importance'} onClick={() => onSetImportant?.(image, !image.userMarkedImportant)}>{image.importance} · {image.importanceScore}</button></td><td>{image.protectionStatus ? 'Protected' : 'Open'}</td><td>{image.modifiedDate}</td><td>{image.fileType}</td><td><button className="more-button" type="button" disabled={image.protectionStatus} onClick={() => onRemove?.(image)}>{image.protectionStatus ? 'Protected' : 'Remove index'}</button></td></tr>)}</tbody></table></div>;
}

function CategoriesView({ counts, onChoose }) {
  return <section className="surface-panel"><div className="library-heading"><div><p className="eyebrow">Library organization</p><h4>Semantic categories</h4></div></div><div className="category-card-grid">{counts.map((item) => <button type="button" className="category-card" key={item.name} onClick={() => onChoose(item.name)}><span className="category-icon">{item.name.slice(0, 1)}</span><strong>{item.name}</strong><span>{item.description}</span><b>{item.count} images</b></button>)}</div></section>;
}

function SecurityView() {
  return <section className="surface-panel settings-panel"><p className="eyebrow">Privacy by design</p><h4>Security & local processing</h4><p className="muted">Your original image files remain in their local folders. MemoryOS stores extracted intelligence and paths for fast retrieval.</p><div className="security-list"><SecurityRow label="Local processing" value="ON" good /><SecurityRow label="Cloud upload" value="OFF" good /><SecurityRow label="OCR & AI metadata" value="Protected locally" good /><SecurityRow label="Database connection" value="Configure MySQL" /></div></section>;
}

function SettingsView() {
  return <section className="surface-panel settings-panel"><p className="eyebrow">Workspace preferences</p><h4>Settings</h4><div className="settings-form"><label>Default scan folder<input placeholder="Choose when scanning" /></label><label>Processing batch size<select defaultValue="10"><option>5 images</option><option>10 images</option><option>25 images</option></select></label><label className="setting-toggle"><input type="checkbox" defaultChecked /> OCR enabled</label><label className="setting-toggle"><input type="checkbox" defaultChecked /> Semantic descriptions enabled</label><label className="setting-toggle"><input type="checkbox" defaultChecked /> Duplicate detection enabled</label><button className="primary-button" type="button" onClick={() => window.alert('Settings saved for this session.')}>Save settings</button></div></section>;
}

function DetailsPanel({ image, onClose, onUpdate, onRemove }) {
  const breakdown = Object.entries(image.importanceBreakdown || {});
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="details-panel" role="dialog" aria-modal="true"><button className="close-button" type="button" onClick={onClose} aria-label="Close details">×</button><img className="details-preview" src={image.previewUrl} alt={image.filename} /><div className="details-content"><p className="eyebrow">Image details</p><h4>{image.filename}</h4><span className="category-label">{image.category}</span><div className={image.protectionStatus ? 'protection-callout protected' : 'protection-callout'}><strong>{image.importance} · {image.importanceScore}/100</strong><span>{image.protectionStatus ? `Protected: ${image.protectionReason || 'deletion is blocked'}` : 'Unprotected: deletion is allowed under policy'}</span></div>{breakdown.length ? <div className="details-section"><strong>Score breakdown</strong><div className="score-breakdown">{breakdown.map(([key, value]) => <span key={key}>{key.replaceAll('_', ' ')} <b>+{value}</b></span>)}</div></div> : null}<dl><dt>Path</dt><dd>{image.filePath}</dd><dt>File type</dt><dd>{image.fileType} · {image.fileSize}</dd><dt>Modified</dt><dd>{image.modifiedDate}</dd><dt>Location</dt><dd>{image.location}</dd></dl><div className="details-section"><strong>AI description</strong><p>{image.visualDescription || 'No visual description returned. Enable the local vision model for captions.'}</p></div><div className="details-section"><strong>OCR text</strong><p>{image.ocrText || 'No text detected.'}</p></div><div className="details-actions"><button className="primary-button" type="button" onClick={() => navigator.clipboard?.writeText(image.filePath)}>Copy path</button><button className="danger-button" type="button" disabled={image.protectionStatus} onClick={() => onRemove(image)}>{image.protectionStatus ? 'Deletion protected' : 'Remove index'}</button></div></div></aside></div>;
}

function SummaryCard({ label, value, detail }) { return <article className="summary-card"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>; }
function SecurityRow({ label, value, good }) { return <div className="security-row"><span>{label}</span><strong className={good ? 'good' : ''}>{value}</strong></div>; }
function ProgressState({ status, progress }) { return <div className="progress-state"><strong>{status}</strong><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><small>{progress}% complete · Processing remains local</small></div>; }
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
function getLocalImportanceScore(category, file, text) { const source = `${file.name} ${text}`.toLowerCase(); const keywordPatterns = { 'Government & Identity': /aadhaar|passport|identity|id|voter|pan|license|licence|dob|nationality/, Education: /degree|diploma|marksheet|transcript|university|college|school|student|exam|semester|grade|thesis/, 'Medical & Health': /prescription|hospital|doctor|patient|diagnosis|medicine|pharmacy|health|laboratory|dosage/, Finance: /bank|statement|income|tax|salary|transaction|payment|cheque|loan|investment|ifsc|balance/, 'Bills & Receipts': /receipt|invoice|bill|subtotal|total|gst|barcode|quantity|discount|due|cashier/, 'Work & Professional': /resume|cv|employment|company|employee|office|professional|linkedin|client|project|agenda/, Travel: /flight|airport|airline|boarding|train|hotel|itinerary|vacation|trip|departure|arrival/, 'Events & Celebrations': /birthday|wedding|party|festival|celebration|christmas|diwali|ceremony|invitation|cake/, 'People & Family': /family|person|people|portrait|friend|selfie|face|child|baby|group/, 'Nature & Places': /mountain|beach|landscape|sunset|lake|river|building|city|monument|forest|nature|skyline/, 'Animals & Pets': /dog|cat|bird|pet|horse|wildlife|animal|puppy|kitten/, 'Food & Drinks': /food|restaurant|dish|meal|lunch|dinner|breakfast|coffee|tea|drink|pizza|menu/, Screenshots: /screenshot|screen|capture|mobile|application|app|website|chat|whatsapp|browser|notification|url/, 'Notes & Documents': /note|handwritten|handwriting|whiteboard|document|scanned|paper|memo|text|signature/ }; let score = 0; if (['Government & Identity', 'Medical & Health'].includes(category)) score += 30; if (['Government & Identity', 'Education', 'Medical & Health', 'Finance', 'Bills & Receipts', 'Work & Professional'].includes(category)) score += 20; if (keywordPatterns[category]?.test(source)) score += 10; if (text.replace(/[^a-z0-9]/gi, '').length >= 8) score += 5; const age = Date.now() - file.lastModified; if (age >= 0 && age <= 30 * 24 * 60 * 60 * 1000) score += 10; return Math.min(score, 100); }
function getLocalImportanceLevel(category, file, text) { const score = getLocalImportanceScore(category, file, text); return score >= 80 ? 'Critical' : score >= 60 ? 'Important' : score >= 30 ? 'Normal' : 'Low'; }
function isLocallyProtected(category, file, text) { return ['Government & Identity', 'Medical & Health'].includes(category) || getLocalImportanceScore(category, file, text) >= 80; }
async function buildDuplicateFingerprint(file) {
  try {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const exactHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { exactHash };
    const aspectRatio = bitmap.width && bitmap.height ? bitmap.width / bitmap.height : null;
    context.drawImage(bitmap, 0, 0, 32, 32);
    bitmap.close();
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const grayscale = [];
    const histogram = new Array(64).fill(0);
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      grayscale.push((red * 299 + green * 587 + blue * 114) / 1000);
      const bin = (red >> 6) * 16 + (green >> 6) * 4 + (blue >> 6);
      histogram[bin] += 1;
    }
    const hashGrid = [];
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 9; column += 1) {
        const sourceRow = Math.min(31, Math.floor((row + 0.5) * 32 / 8));
        const sourceColumn = Math.min(31, Math.floor((column + 0.5) * 32 / 9));
        hashGrid.push(grayscale[sourceRow * 32 + sourceColumn]);
      }
    }
    const rowHash = [];
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        rowHash.push(hashGrid[row * 9 + column] < hashGrid[row * 9 + column + 1] ? '1' : '0');
      }
    }
    const totalPixels = 32 * 32;
    return {
      exactHash,
      differenceHash: rowHash.join(''),
      histogram: histogram.map((value) => value / totalPixels),
      aspectRatio,
    };
  } catch (error) {
    return null;
  }
}

function findDuplicateMatch(fingerprint, images) {
  if (!fingerprint) return null;
  for (const image of images) {
    const candidate = image.duplicateFingerprint;
    if (!candidate) continue;
    if (candidate.exactHash && candidate.exactHash === fingerprint.exactHash) {
      return { filename: image.filename, reason: 'exact file content' };
    }
    if (!candidate.differenceHash || !fingerprint.differenceHash || !candidate.histogram || !fingerprint.histogram) continue;
    const aspectDifference = candidate.aspectRatio && fingerprint.aspectRatio
      ? Math.abs(candidate.aspectRatio - fingerprint.aspectRatio) / Math.max(candidate.aspectRatio, fingerprint.aspectRatio)
      : 1;
    const hashDistance = hammingDistance(candidate.differenceHash, fingerprint.differenceHash);
    const histogramDistance = candidate.histogram.reduce((total, value, index) => total + Math.abs(value - fingerprint.histogram[index]), 0);
    if (aspectDifference <= 0.02 && hashDistance <= 4 && histogramDistance <= 0.16) {
      return { filename: image.filename, reason: 'matching visual structure and color distribution' };
    }
  }
  return null;
}

function hammingDistance(left, right) {
  let distance = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) distance += left[index] === right[index] ? 0 : 1;
  return distance + Math.abs(left.length - right.length);
}

function findDuplicates(images) {
  return images.filter((image) => image.duplicate);
}
