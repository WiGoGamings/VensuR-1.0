import './RightRail.css'
import { memo } from 'react'

/**
 * @param {{ items: import('../../data/feedData').FocusItem[] }} props
 */
function FocusPanel({ items }) {
  return (
    <section className="side-card focus-card">
      <h2>
        En foco <span>● EN VIVO</span>
      </h2>
      {items.map((item) => (
        <div className="focus-item" key={item.id}>
          <i className={`pulse ${item.pulse}`} />
          <div>
            <strong>{item.title}</strong>
            <small>{item.subtitle}</small>
          </div>
        </div>
      ))}
    </section>
  )
}

/**
 * @param {{ topic: import('../../data/feedData').WeeklyTopic }} props
 */
function TopicPanel({ topic }) {
  return (
    <section className="side-card topic-card">
      <h2>Tema de la semana</h2>
      <div className="topic-line">
        <i className={`pulse ${topic.pulse}`} />
        <div>
          <strong>{topic.title}</strong>
          <small>{topic.subtitle}</small>
        </div>
      </div>
    </section>
  )
}

function QuoteCard() {
  return (
    <section className="quote">
      <span>“</span>
      <p>La realidad tambien se construye cuando decidimos contarla.</p>
      <small>— Comunidad VE</small>
    </section>
  )
}

/**
 * @param {{
 * focusItems: import('../../data/feedData').FocusItem[],
 * topic: import('../../data/feedData').WeeklyTopic
 * }} props
 */
export default memo(function RightRail({ focusItems, topic }) {
  return (
    <aside className="right-rail" id="focus">
      <FocusPanel items={focusItems} />
      <TopicPanel topic={topic} />
      <QuoteCard />
    </aside>
  )
})
