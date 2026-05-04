/**
 * NoteList - 笔记列表组件
 * 优化版本：只显示标题，全量 Fragment 替换，事件委托
 */

import { t } from '../utils/i18n.js';
import { showContextMenu } from './ContextMenu.js';

export class NoteList {
  constructor(props = {}) {
    this.props = props;
    this.state = {
      notes: [],
      activeId: null,
      searchQuery: '',
    };
    this.el = null;
    this._cleanup = [];
    this._contextMenu = null;
    this._isDragging = false;
    this._dragNoteId = null;
    this._dragElement = null;
    this._dragClone = null;
    this._startY = 0;
    this._suppressClick = false;
    this._editingNoteId = null;
    this._editingInput = null;
    this._editingOriginalTitle = '';
    this._onPointerMove = null;
    this._onPointerUp = null;
    this._setupListeners();
    this._loadInitialData();
  }

  /**
   * 加载初始数据
   */
  _loadInitialData() {
    if (this.props.store && this.props.store.state.notes) {
      this.setState({
        notes: this.props.store.state.notes,
        activeId: this.props.store.state.activeNoteId,
      });
    }
  }

  setState(newState) {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...newState };
    return oldState;
  }

  /**
   * 获取当前应显示的笔记（搜索 or 排序）
   */
  _getDisplayNotes() {
    if (this.state.searchQuery) {
      return this.props.store?.searchNotes(this.state.searchQuery) || [];
    }
    return this.props.store?.getSortedNotes() || [];
  }

  /**
   * 渲染组件（首次挂载）
   */
  render() {
    const container = document.createElement('div');
    container.className = 'note-list';

    const notes = this._getDisplayNotes();

    if (notes.length === 0) {
      container.innerHTML = this._renderEmpty();
      return container;
    }

    this._buildList(container, notes);
    return container;
  }

  /**
   * 初始化（DOM 挂载后）
   */
  initialize() {
    if (this.el) {
      this._syncActiveState();
    }
  }

  /**
   * 用 DocumentFragment 构建列表
   */
  _buildList(container, notes) {
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();

    notes.forEach((note, index) => {
      fragment.appendChild(this._renderItem(note));

      if (note.pinned && (index === notes.length - 1 || !notes[index + 1]?.pinned)) {
        const divider = document.createElement('div');
        divider.className = 'pinned-divider';
        divider.dataset.type = 'divider';
        fragment.appendChild(divider);
      }
    });

    container.appendChild(fragment);
  }

  /**
   * 渲染单个笔记项（只有标题）
   */
  _renderItem(note) {
    const isActive = note.id === this.state.activeId;
    const isPinned = note.pinned || false;

    const item = document.createElement('div');
    item.className = `note-item${isPinned ? ' pinned' : ''}${isActive ? ' active' : ''}`;
    item.dataset.id = note.id;
    item.dataset.type = 'item';

    const title = document.createElement('div');
    title.className = 'note-item-title';
    title.textContent = note.title || t('unnamedNote');

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'note-item-delete';
    deleteBtn.type = 'button';
    deleteBtn.ariaLabel = t('delete');
    deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 4.5h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M6.5 2.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M5 6.5v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M8 6.5v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M11 6.5v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M4.5 4.5l.4 7.1a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.4-7.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    item.append(title, deleteBtn);
    return item;
  }

  /**
   * 事件委托：click + contextmenu
   */
  _bindItemEvents(container) {
    container.addEventListener('click', (e) => {
      if (this._suppressClick) {
        this._suppressClick = false;
        return;
      }

      const deleteBtn = e.target.closest('.note-item-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const item = deleteBtn.closest('.note-item');
        const noteId = item?.dataset.id;
        const note = this.state.notes.find(n => n.id === noteId);
        if (note) {
          this.props.bus?.emit('note:delete-request', note);
        }
        return;
      }

      const item = e.target.closest('.note-item');
      if (item) {
        if (e.target.closest('.note-item-title-input')) return;
        const noteId = item.dataset.id;
        const note = this.state.notes.find(n => n.id === noteId);
        if (note) this._handleSelect(note);
      }
    });

    container.addEventListener('contextmenu', (e) => {
      if (this._editingInput && e.target.closest('.note-item-title-input')) return;
      const item = e.target.closest('.note-item');
      if (item) {
        e.preventDefault();
        const noteId = item.dataset.id;
        const note = this.state.notes.find(n => n && n.id === noteId);
        if (note) {
          const index = this.state.notes.findIndex(n => n.id === noteId);
          this._showContextMenu(e, note, index);
        }
      }
    });

    // 拖拽排序（pointer events 事件委托，存活于 DOM 重建）
    container.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.state.searchQuery) return;
      if (e.target.closest('.note-item-delete')) return;
      if (e.target.closest('.note-item-title-input')) return;
      if (this._editingNoteId) return;

      const item = e.target.closest('.note-item');
      if (!item) return;

      this._startY = e.clientY;
      this._dragElement = item;
      this._dragNoteId = item.dataset.id;

      const onPointerMove = (moveEvent) => {
        const dy = Math.abs(moveEvent.clientY - this._startY);
        if (!this._isDragging && dy > 5) {
          this._isDragging = true;
          item.classList.add('dragging');
          document.body.classList.add('is-dragging-note');

          const clone = item.cloneNode(true);
          clone.className = 'note-item drag-clone';
          clone.style.position = 'fixed';
          clone.style.left = item.getBoundingClientRect().left + 'px';
          clone.style.width = item.offsetWidth + 'px';
          clone.style.top = moveEvent.clientY - item.offsetHeight / 2 + 'px';
          clone.style.zIndex = '9999';
          clone.style.pointerEvents = 'none';
          clone.style.opacity = '0.85';
          document.body.appendChild(clone);
          this._dragClone = clone;
        }

        if (this._isDragging && this._dragClone) {
          this._dragClone.style.top = moveEvent.clientY - item.offsetHeight / 2 + 'px';
          this._updateDropIndicator(moveEvent.clientY);
        }
      };

      const onPointerUp = async (upEvent) => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);

        if (this._isDragging) {
          const dropLocation = this._getDropLocation(upEvent.clientY);
          if (dropLocation) {
            const dragId = this._dragNoteId;
            this._suppressClick = true;
            this._cleanupDrag();
            await this.props.store?.moveNoteToPosition(dragId, dropLocation.targetIndex);
            return;
          }
          this._cleanupDrag();
        }

        this._dragElement = null;
        this._dragNoteId = null;
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });

    container.addEventListener('dblclick', (e) => {
      const titleEl = e.target.closest('.note-item-title');
      if (!titleEl) return;

      const item = titleEl.closest('.note-item');
      const noteId = item?.dataset.id;
      const note = this.state.notes.find(n => n.id === noteId);
      if (!item || !note) return;

      e.preventDefault();
      e.stopPropagation();
      this._handleSelect(note);
      this._startTitleEdit(item, note);
    });
  }

  _renderEmpty() {
    return `
      <div class="note-list-empty">
        <div class="empty-icon">📝</div>
        <div class="empty-title">${t('emptyTitle')}</div>
        <div class="empty-desc">${t('emptyDesc')}</div>
      </div>
    `;
  }

  /**
   * 设置事件监听
   */
  _setupListeners() {
    // 数据变化 → 全量 Fragment 替换
    const unsubChange = this.props.store?.on('change', () => {
      this._handleStoreChange();
    });
    if (unsubChange) this._cleanup.push(unsubChange);

    // 选中变化 → 只切换 CSS class（不触发重渲染）
    const unsubSelect = this.props.bus?.on('note:select', (id) => {
      const oldState = this.setState({ activeId: id });
      this._updateActiveState(oldState.activeId, id);
    });
    if (unsubSelect) this._cleanup.push(unsubSelect);

    // 搜索变化
    const unsubSearch = this.props.bus?.on('search:change', (query) => {
      this.setState({ searchQuery: query });
      this._handleStoreChange();
    });
    if (unsubSearch) this._cleanup.push(unsubSearch);

    // 创建笔记 - 清空空状态占位
    const unsubCreate = this.props.bus?.on('note:create', () => {
      if (this.el) this.el.innerHTML = '';
    });
    if (unsubCreate) this._cleanup.push(unsubCreate);
  }

  /**
   * 数据变化处理 - 全量 Fragment 替换
   * 比差异化更新更快：省去 O(n²) 的 DOM 对比和定位
   */
  _handleStoreChange() {
    if (!this.el) return;

    // 拖拽中跳过重建，避免拖拽状态丢失
    if (this._isDragging) return;

    // 同步 store 端的 activeId（跨设备同步场景）
    this.state.activeId = this.props.store?.state.activeNoteId ?? this.state.activeId;

    const notes = this._getDisplayNotes();
    this.state.notes = notes;

    if (notes.length === 0) {
      this.el.innerHTML = this._renderEmpty();
      return;
    }

    this._buildList(this.el, notes);
  }

  /**
   * 切换选中态 - 只操作 CSS class，不重渲染
   */
  _updateActiveState(oldId, newId) {
    if (oldId === newId) return;

    if (oldId) {
      const oldEl = this.el?.querySelector(`[data-id="${oldId}"]`);
      if (oldEl) oldEl.classList.remove('active');
    }
    if (newId) {
      const newEl = this.el?.querySelector(`[data-id="${newId}"]`);
      if (newEl) newEl.classList.add('active');
    }
  }

  _syncActiveState() {
    if (!this.el || !this.state.activeId) return;
    this.el.querySelectorAll('.note-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === this.state.activeId);
    });
  }

  _handleSelect(note) {
    this.props.store?.setActiveNote(note.id);
    this.props.bus?.emit('note:select', note.id);
  }

  _showContextMenu(e, note, index) {
    if (this._contextMenu) {
      this._contextMenu.close();
    }

    const groupNotes = this.props.store?.getSortedNotes()
      .filter(item => !!item.pinned === !!note.pinned) || [];
    const groupIndex = groupNotes.findIndex(item => item.id === note.id);

    this._contextMenu = showContextMenu({
      x: e.clientX,
      y: e.clientY,
      index: groupIndex === -1 ? index : groupIndex,
      total: groupNotes.length || this.state.notes.length,
      note,
      onSelect: (action) => this._handleMenuAction(action, note),
    });
  }

  async _handleMenuAction(action, note) {
    const store = this.props.store;
    if (!store) return;

    switch (action) {
      case 'move-up':
        await store.moveNoteUp(note.id);
        break;
      case 'move-down':
        await store.moveNoteDown(note.id);
        break;
      case 'pin':
        await store.togglePin(note.id);
        break;
      case 'delete':
        this.props.bus?.emit('note:delete-request', note);
        break;
    }
  }

  /**
   * 开始编辑笔记标题
   * @param {HTMLElement} item
   * @param {Object} note
   */
  _startTitleEdit(item, note) {
    if (this._editingNoteId === note.id && this._editingInput) {
      this._editingInput.focus();
      this._editingInput.select();
      return;
    }

    if (this._editingInput) {
      this._commitTitleEdit();
    }

    const titleEl = item.querySelector('.note-item-title');
    if (!titleEl) return;

    this._editingNoteId = note.id;
    this._editingOriginalTitle = note.title || '';

    const input = document.createElement('input');
    input.className = 'note-item-title-input';
    input.type = 'text';
    input.value = note.title || '';
    input.placeholder = t('unnamedNote');

    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    input.addEventListener('dblclick', (e) => {
      e.stopPropagation();
    });
    input.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._commitTitleEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._cancelTitleEdit();
      }
    });
    input.addEventListener('blur', () => {
      this._commitTitleEdit();
    });

    item.classList.add('editing');
    titleEl.replaceWith(input);
    this._editingInput = input;

    requestAnimationFrame(() => {
      if (this._editingInput === input) {
        input.focus();
        input.select();
      }
    });
  }

  /**
   * 提交标题编辑
   */
  async _commitTitleEdit() {
    const input = this._editingInput;
    const noteId = this._editingNoteId;
    if (!input || !noteId) return;

    const item = input.closest('.note-item');
    const note = this.props.store?.state.notes.find(n => n.id === noteId);
    const nextTitle = input.value.trim();
    const prevTitle = this._editingOriginalTitle;

    this._editingInput = null;
    this._editingNoteId = null;
    this._editingOriginalTitle = '';

    this._restoreTitleNode(item, nextTitle);

    if (note && nextTitle !== prevTitle) {
      await this.props.store?.updateNote(noteId, { title: nextTitle });
    }
  }

  /**
   * 取消标题编辑
   */
  _cancelTitleEdit() {
    const input = this._editingInput;
    const item = input?.closest('.note-item');
    if (!input || !item) return;

    this._editingInput = null;
    this._editingNoteId = null;
    const originalTitle = this._editingOriginalTitle;
    this._editingOriginalTitle = '';
    this._restoreTitleNode(item, originalTitle);
  }

  /**
   * 恢复标题展示节点
   * @param {HTMLElement|null} item
   * @param {string} title
   */
  _restoreTitleNode(item, title) {
    if (!item) return;

    const currentInput = item.querySelector('.note-item-title-input');
    if (!currentInput) return;

    const titleEl = document.createElement('div');
    titleEl.className = 'note-item-title';
    titleEl.textContent = title || t('unnamedNote');

    currentInput.replaceWith(titleEl);
    item.classList.remove('editing');
  }

  /**
   * 清除所有拖拽放置指示器
   */
  _clearDropIndicators() {
    this.el?.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  }

  /**
   * 获取当前拖拽笔记可排序的同组元素
   */
  _getDraggableGroupElements() {
    const dragNote = this.props.store?.state.notes.find(note => note.id === this._dragNoteId);
    if (!dragNote || !this.el) return [];

    return Array.from(this.el.querySelectorAll('.note-item')).filter((el) => {
      if (el.dataset.id === this._dragNoteId) return false;
      const note = this.props.store?.state.notes.find(item => item.id === el.dataset.id);
      return note && !!note.pinned === !!dragNote.pinned;
    });
  }

  /**
   * 计算当前光标对应的落点位置
   */
  _getDropLocation(y) {
    const groupElements = this._getDraggableGroupElements();
    if (!groupElements.length) return null;

    for (let index = 0; index < groupElements.length; index += 1) {
      const element = groupElements[index];
      const rect = element.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (y < midY) {
        return {
          element,
          targetIndex: index,
          position: 'before',
        };
      }
    }

    return {
      element: groupElements[groupElements.length - 1],
      targetIndex: groupElements.length,
      position: 'after',
    };
  }

  /**
   * 根据落点刷新拖拽指示器
   */
  _updateDropIndicator(y) {
    this._clearDropIndicators();

    const dropLocation = this._getDropLocation(y);
    if (!dropLocation) return;

    dropLocation.element.classList.add(
      dropLocation.position === 'before' ? 'drag-over-top' : 'drag-over-bottom'
    );
  }


  /**
   * 清理拖拽状态
   */
  _cleanupDrag() {
    this._isDragging = false;
    this._dragNoteId = null;
    this._dragElement = null;
    this._clearDropIndicators();
    document.body.classList.remove('is-dragging-note');
    this.el?.querySelectorAll('.dragging').forEach(el => {
      el.classList.remove('dragging');
    });
    if (this._dragClone) {
      this._dragClone.remove();
      this._dragClone = null;
    }
  }

  destroy() {
    this._cancelTitleEdit();
    if (this._contextMenu) {
      this._contextMenu.close();
    }
    this._cleanup.forEach(fn => fn());
    this.el?.remove();
  }
}
