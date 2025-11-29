import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TopBar from './TopBar.vue'

describe('TopBar.vue', () => {
    it('renders correctly when idle', () => {
        const wrapper = mount(TopBar, {
            props: {
                running: false,
                paused: false,
                status: 'idle',
                sections: 0,
                tokenTally: 0
            }
        })
        expect(wrapper.text()).toContain('DistillBoard')
        expect(wrapper.find('button.primary').element.disabled).toBe(false) // Start button
        expect(wrapper.text()).toContain('Start')
    })

    it('renders correctly when running', () => {
        const wrapper = mount(TopBar, {
            props: {
                running: true,
                paused: false,
                status: 'running',
                sections: 2,
                tokenTally: 100
            }
        })
        expect(wrapper.find('button.primary').element.disabled).toBe(true) // Start button disabled
        expect(wrapper.text()).toContain('Pause')
        expect(wrapper.text()).toContain('sections: 2')
    })

    it('emits start event', async () => {
        const wrapper = mount(TopBar)
        await wrapper.find('button.primary').trigger('click')
        expect(wrapper.emitted('start')).toBeTruthy()
    })

    it('emits togglePause event', async () => {
        const wrapper = mount(TopBar, {
            props: { running: true }
        })
        const buttons = wrapper.findAll('button')
        const pauseBtn = buttons[1] // Start is 0, Pause is 1
        await pauseBtn.trigger('click')
        expect(wrapper.emitted('togglePause')).toBeTruthy()
    })
})
