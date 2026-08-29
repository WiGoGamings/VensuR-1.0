import FeedColumn from '../components/feed/FeedColumn'

/**
 * @param {{
 * stories: import('../data/feedData').StoryItem[],
 * posts: import('../data/feedData').Post[],
 * draft: string,
 * isLoading: boolean,
 * errorMessage: string,
 * isSubmitting: boolean,
 * onDraftChange: (value: string) => void,
 * mediaFileName: string,
 * isAuthenticated: boolean,
 * onMediaSelect: (file: File | null) => void,
 * onSubmit: (event: import('react').FormEvent<HTMLFormElement>) => void,
 * likedPostIds: Array<string | number>,
 * onToggleLike: (id: string | number) => void
 * }} props
 */
export default function InicioPage(props) {
  return <FeedColumn {...props} />
}
