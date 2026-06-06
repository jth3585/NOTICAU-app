import { MarkdownPage } from '../components/MarkdownPage';
import { TERMS_MD } from '../lib/legalText';

export default function TermsScreen() {
  return <MarkdownPage title="이용약관" markdown={TERMS_MD} />;
}
