import { useLayoutEffect, useState } from 'react'
import css from './composer.module.css'

export function DraftImagePreview({ file }: { readonly file: File }) {
  const [url, setUrl] = useState<string>()

  // Sending or leaving can discard the chip without going through its remove button.
  useLayoutEffect(() => {
    const preview = URL.createObjectURL(file)
    setUrl(preview)
    return () => { URL.revokeObjectURL(preview) }
  }, [file])

  return url === undefined ? null : <img src={url} alt="" className={css.imageChipPreview} />
}
