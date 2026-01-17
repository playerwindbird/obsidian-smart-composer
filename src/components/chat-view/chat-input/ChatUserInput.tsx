import { useQuery } from '@tanstack/react-query'
import { $nodesOfType, LexicalEditor, SerializedEditorState } from 'lexical'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useApp } from '../../../contexts/app-context'
import {
  Mentionable,
  MentionableImage,
  SerializedMentionable,
} from '../../../types/mentionable'
import {
  deserializeMentionable,
  getMentionableKey,
  serializeMentionable,
} from '../../../utils/chat/mentionable'
import { fileToMentionableImage } from '../../../utils/llm/image'
import { openMarkdownFile, readTFileContent } from '../../../utils/obsidian'
import { ObsidianMarkdown } from '../ObsidianMarkdown'

import { ImageUploadButton } from './ImageUploadButton'
import LexicalContentEditable from './LexicalContentEditable'
import MentionableBadge from './MentionableBadge'
import { ModelSelect } from './ModelSelect'
import { MentionNode } from './plugins/mention/MentionNode'
import { NodeMutations } from './plugins/on-mutation/OnMutationPlugin'
import { SubmitButton } from './SubmitButton'
import ToolBadge from './ToolBadge'
import { VaultChatButton } from './VaultChatButton'

export type ChatUserInputRef = {
  focus: () => void
}

export type ChatUserInputProps = {
  initialSerializedEditorState: SerializedEditorState | null
  onChange: (content: SerializedEditorState) => void
  onSubmit: (content: SerializedEditorState, useVaultSearch?: boolean) => void
  onFocus: () => void
  mentionables: Mentionable[]
  setMentionables: (mentionables: Mentionable[]) => void
  autoFocus?: boolean
  addedBlockKey?: string | null
}

const ChatUserInput = forwardRef<ChatUserInputRef, ChatUserInputProps>(
  (
    {
      initialSerializedEditorState,
      onChange,
      onSubmit,
      onFocus,
      mentionables,
      setMentionables,
      autoFocus = false,
      addedBlockKey,
    },
    ref,
  ) => {
    const app = useApp()

    const editorRef = useRef<LexicalEditor | null>(null)
    const contentEditableRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const [displayedMentionableKey, setDisplayedMentionableKey] = useState<
      string | null
    >(addedBlockKey ?? null)

    useEffect(() => {
      if (addedBlockKey) {
        setDisplayedMentionableKey(addedBlockKey)
      }
    }, [addedBlockKey])

    useImperativeHandle(ref, () => ({
      focus: () => {
        contentEditableRef.current?.focus()
      },
    }))

    const handleMentionNodeMutation = (
      mutations: NodeMutations<MentionNode>,
    ) => {
      const destroyedMentionableKeys: string[] = []
      const addedMentionables: SerializedMentionable[] = []
      mutations.forEach((mutation) => {
        const mentionable = mutation.node.getMentionable()
        const mentionableKey = getMentionableKey(mentionable)

        if (mutation.mutation === 'destroyed') {
          const nodeWithSameMentionable = editorRef.current?.read(() =>
            $nodesOfType(MentionNode).find(
              (node) =>
                getMentionableKey(node.getMentionable()) === mentionableKey,
            ),
          )

          if (!nodeWithSameMentionable) {
            // remove mentionable only if it's not present in the editor state
            destroyedMentionableKeys.push(mentionableKey)
          }
        } else if (mutation.mutation === 'created') {
          if (
            mentionables.some(
              (m) =>
                getMentionableKey(serializeMentionable(m)) === mentionableKey,
            ) ||
            addedMentionables.some(
              (m) => getMentionableKey(m) === mentionableKey,
            )
          ) {
            // do nothing if mentionable is already added
            return
          }

          addedMentionables.push(mentionable)
        }
      })

      setMentionables(
        mentionables
          .filter(
            (m) =>
              !destroyedMentionableKeys.includes(
                getMentionableKey(serializeMentionable(m)),
              ),
          )
          .concat(
            addedMentionables
              .map((m) => deserializeMentionable(m, app))
              .filter((v) => !!v),
          ),
      )
      if (addedMentionables.length > 0) {
        setDisplayedMentionableKey(
          getMentionableKey(addedMentionables[addedMentionables.length - 1]),
        )
      }
    }

    const handleCreateImageMentionables = useCallback(
      (mentionableImages: MentionableImage[]) => {
        const newMentionableImages = mentionableImages.filter(
          (m) =>
            !mentionables.some(
              (mentionable) =>
                getMentionableKey(serializeMentionable(mentionable)) ===
                getMentionableKey(serializeMentionable(m)),
            ),
        )
        if (newMentionableImages.length === 0) return
        setMentionables([...mentionables, ...newMentionableImages])
        setDisplayedMentionableKey(
          getMentionableKey(
            serializeMentionable(
              newMentionableImages[newMentionableImages.length - 1],
            ),
          ),
        )
      },
      [mentionables, setMentionables],
    )

    const handleMentionableDelete = (mentionable: Mentionable) => {
      const mentionableKey = getMentionableKey(
        serializeMentionable(mentionable),
      )
      setMentionables(
        mentionables.filter(
          (m) => getMentionableKey(serializeMentionable(m)) !== mentionableKey,
        ),
      )

      editorRef.current?.update(() => {
        $nodesOfType(MentionNode).forEach((node) => {
          if (getMentionableKey(node.getMentionable()) === mentionableKey) {
            node.remove()
          }
        })
      })
    }

    const handleUploadImages = async (images: File[]) => {
      const mentionableImages = await Promise.all(
        images.map((image) => fileToMentionableImage(image)),
      )
      handleCreateImageMentionables(mentionableImages)
    }

    const handleSubmit = (options: { useVaultSearch?: boolean } = {}) => {
      const content = editorRef.current?.getEditorState()?.toJSON()
      content && onSubmit(content, options.useVaultSearch)
    }

    return (
      <div className="smtcmp-chat-user-input-container" ref={containerRef}>
        <div className="smtcmp-chat-user-input-files">
          <ToolBadge />
          {mentionables.map((m) => (
            <MentionableBadge
              key={getMentionableKey(serializeMentionable(m))}
              mentionable={m}
              onDelete={() => handleMentionableDelete(m)}
              onClick={() => {
                const mentionableKey = getMentionableKey(
                  serializeMentionable(m),
                )
                if (
                  (m.type === 'current-file' ||
                    m.type === 'file' ||
                    m.type === 'block') &&
                  m.file &&
                  mentionableKey === displayedMentionableKey
                ) {
                  // open file on click again
                  openMarkdownFile(
                    app,
                    m.file.path,
                    m.type === 'block' ? m.startLine : undefined,
                  )
                } else {
                  setDisplayedMentionableKey(mentionableKey)
                }
              }}
              isFocused={
                getMentionableKey(serializeMentionable(m)) ===
                displayedMentionableKey
              }
            />
          ))}
        </div>

        <MentionableContentPreview
          displayedMentionableKey={displayedMentionableKey}
          mentionables={mentionables}
        />

        <LexicalContentEditable
          initialEditorState={(editor) => {
            if (initialSerializedEditorState) {
              editor.setEditorState(
                editor.parseEditorState(initialSerializedEditorState),
              )
            }
          }}
          editorRef={editorRef}
          contentEditableRef={contentEditableRef}
          onChange={onChange}
          onEnter={() => handleSubmit({ useVaultSearch: false })}
          onFocus={onFocus}
          onMentionNodeMutation={handleMentionNodeMutation}
          onCreateImageMentionables={handleCreateImageMentionables}
          autoFocus={autoFocus}
          plugins={{
            onEnter: {
              onVaultChat: () => {
                handleSubmit({ useVaultSearch: true })
              },
            },
            templatePopover: {
              anchorElement: containerRef.current,
            },
          }}
        />

        <div className="smtcmp-chat-user-input-controls">
          <div className="smtcmp-chat-user-input-controls__model-select-container">
            <ModelSelect />
          </div>
          <div className="smtcmp-chat-user-input-controls__buttons">
            <ImageUploadButton onUpload={handleUploadImages} />
            <SubmitButton onClick={() => handleSubmit()} />
            <VaultChatButton
              onClick={() => {
                handleSubmit({ useVaultSearch: true })
              }}
            />
          </div>
        </div>
      </div>
    )
  },
)

function MentionableContentPreview({
  displayedMentionableKey,
  mentionables,
}: {
  displayedMentionableKey: string | null
  mentionables: Mentionable[]
}) {
  const app = useApp()

  const displayedMentionable: Mentionable | null = useMemo(() => {
    return (
      mentionables.find(
        (m) =>
          getMentionableKey(serializeMentionable(m)) ===
          displayedMentionableKey,
      ) ?? null
    )
  }, [displayedMentionableKey, mentionables])

  const { data: displayFileContent } = useQuery({
    enabled:
      !!displayedMentionable &&
      ['file', 'current-file', 'block'].includes(displayedMentionable.type),
    queryKey: [
      'file',
      displayedMentionableKey,
      mentionables.map((m) => getMentionableKey(serializeMentionable(m))), // should be updated when mentionables change (especially on delete)
    ],
    queryFn: async () => {
      if (!displayedMentionable) return null
      if (
        displayedMentionable.type === 'file' ||
        displayedMentionable.type === 'current-file'
      ) {
        if (!displayedMentionable.file) return null
        return await readTFileContent(displayedMentionable.file, app.vault)
      } else if (displayedMentionable.type === 'block') {
        const fileContent = await readTFileContent(
          displayedMentionable.file,
          app.vault,
        )

        return fileContent
          .split('\n')
          .slice(
            displayedMentionable.startLine - 1,
            displayedMentionable.endLine,
          )
          .join('\n')
      }

      return null
    },
  })

  const displayImage: MentionableImage | null = useMemo(() => {
    return displayedMentionable?.type === 'image' ? displayedMentionable : null
  }, [displayedMentionable])

  return displayFileContent ? (
    <div className="smtcmp-chat-user-input-file-content-preview">
      <ObsidianMarkdown content={displayFileContent} scale="xs" />
    </div>
  ) : displayImage ? (
    <div className="smtcmp-chat-user-input-file-content-preview">
      <img src={displayImage.data} alt={displayImage.name} />
    </div>
  ) : null
}

ChatUserInput.displayName = 'ChatUserInput'

export default ChatUserInput


// --- GEMINI FIX START: 移动端键盘高度自适应增强版 ---
    useEffect(() => {
      // 1. 仅在移动端生效
      const isMobile = document.body.classList.contains('is-mobile')
      if (!isMobile) return

      const handleVisualResize = () => {
        // 确保 API 可用
        if (!window.visualViewport || !containerRef.current) return

        // 尝试找到最外层的聊天容器 (对应 styles.css 中的 .smtcmp-chat-container)
        // 使用 closest 比 parentElement 更稳健
        const chatContainer = containerRef.current.closest('.smtcmp-chat-container') as HTMLElement | null
        
        if (chatContainer) {
          const viewportHeight = window.visualViewport.height
          const viewportOffsetTop = window.visualViewport.offsetTop // 视口距离页面顶部的距离
          const elementTop = chatContainer.getBoundingClientRect().top // 元素距离视口顶部的距离
          
          // 计算绝对偏移量：元素距离页面顶部的实际距离
          // 注意：getBoundingClientRect().top 会随着页面滚动而变化，但在 Obsidian 移动端 App 内部通常是相对稳定的
          // 这里的核心逻辑是：可视高度 - 容器距离顶部的距离 = 容器应有的高度
          
          // 获取当前窗口的完整高度作为参考
          const windowHeight = window.innerHeight;
          
          // 判断键盘是否可能已关闭 (可视高度接近窗口高度)
          // 阈值设为 100px 以兼容底部导航栏等差异
          const isKeyboardClosed = Math.abs(viewportHeight - windowHeight) < 100;

          if (isKeyboardClosed) {
            // [关键改进] 键盘关闭时，清除内联高度，回归 CSS 的 height: 100% 自适应
            // 这样可以修复旋转屏幕或分屏后高度卡死的问题
            chatContainer.style.height = '';
            chatContainer.style.minHeight = ''; 
          } else {
             // 键盘开启时，强制计算像素高度
            // 修正计算：有时候 topOffset 可能会因为 safe-area 变得不准，
            // 简单的做法是：可视高度 - 容器顶部距离
            const newHeight = viewportHeight - elementTop;
            
            // 只有高度确实有明显变化时才应用，避免抖动
            if (newHeight > 0 && Math.abs(chatContainer.clientHeight - newHeight) > 5) {
               chatContainer.style.height = `${newHeight}px`;
               // 防止 flex 子元素压缩过度
               chatContainer.style.minHeight = `${newHeight}px`;
            }
            
            // 确保输入框在可视范围内
            setTimeout(() => {
                 if (document.activeElement === contentEditableRef.current) {
                    contentEditableRef.current?.scrollIntoView({
                        behavior: 'auto', // 移动端瞬间跳转比 smooth 更少出 bug
                        block: 'nearest' 
                    });
                 }
            }, 100);
          }
        }
      }

      // 监听视口变化（键盘弹出/收起、旋转）
      window.visualViewport.addEventListener('resize', handleVisualResize)
      window.visualViewport.addEventListener('scroll', handleVisualResize)

      // 初始化执行一次
      handleVisualResize()

      return () => {
        window.visualViewport?.removeEventListener('resize', handleVisualResize)
        window.visualViewport?.removeEventListener('scroll', handleVisualResize)
        
        // 组件卸载时清理样式
        const chatContainer = containerRef.current?.closest('.smtcmp-chat-container') as HTMLElement | null
        if (chatContainer) {
          chatContainer.style.height = ''
          chatContainer.style.minHeight = ''
        }
      }
    }, [])
    // --- GEMINI FIX END ---
